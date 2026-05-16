import { z } from 'zod';
import type { DecryptedMessage } from '@mysten/sui-stack-messaging';
import type { ToolDef } from '../mcp/dispatch.js';
import { ChannelSendArgs, ChannelHistoryArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';
import type { Outbox } from '../outbox.js';

/**
 * Recognize transient network/relayer failures that we should queue for retry
 * via the outbox. Mirrors the predicate used in `scripts/spike-sdk.ts`'s
 * `isRelayerUnreachable` — these are the substrings Node + fetch surface when
 * the relayer / RPC endpoint is unreachable. We deliberately do NOT match
 * generic "5" digit sequences (the plan's draft predicate did, which would
 * misclassify any error containing a 5 — e.g. a payload size of `length=5`).
 */
function isInfraError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const stack = `${e.message}\n${e.stack ?? ''}`.toLowerCase();
  return (
    stack.includes('econnrefused') ||
    stack.includes('fetch failed') ||
    stack.includes('enotfound') ||
    stack.includes('etimedout') ||
    stack.includes('network is unreachable') ||
    stack.includes('socket hang up')
  );
}

/**
 * Envelope written into the encrypted `text` field of every message we send.
 *
 * We deliberately do NOT use the SDK's native `files` / attachments path here:
 *   1. T8's scope is "send + history", not Walrus blob uploads — the SDK
 *      attachments pipeline would require us to download bytes, build
 *      `AttachmentFile { fileName, mimeType, data }` records, and route them
 *      through `WalrusHttpStorageAdapter`. That belongs in T11/T12.
 *   2. The plan's `attachments: refs?.map(uri => ({ uri }))` shape is wrong on
 *      two counts: the field is `files`, not `attachments`, and the element
 *      type is `AttachmentFile`, not `{ uri }`.
 *
 * Instead we serialize `refs` (and `agent_id` / `parent_message_id` metadata)
 * into a JSON envelope and stuff it into `text`. `channel.history` parses the
 * envelope back out, falling back to a plain-text representation when a
 * message wasn't sent by us. Once T11/T12 land we can migrate selectively.
 */
interface MessageEnvelope {
  type: 'text';
  text: string;
  agent_id: string | null;
  parent_message_id: string | null;
  refs: string[];
}

function tryParseEnvelope(s: string): MessageEnvelope | { type: 'text'; text: string } {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      (parsed as { type: unknown }).type === 'text'
    ) {
      return parsed as MessageEnvelope;
    }
    // Valid JSON but not our envelope — surface as plain text so callers
    // don't have to deal with an arbitrary parsed shape.
    return { type: 'text', text: s };
  } catch {
    return { type: 'text', text: s };
  }
}

export function sendTool(
  sdk: SdkContext,
  outbox: Outbox,
): ToolDef<z.infer<typeof ChannelSendArgs>> {
  return {
    name: 'channel.send',
    description: 'Send a message to a channel; refs are Walrus URIs',
    schema: ChannelSendArgs,
    handler: async (args) => {
      const { channel_id, content, refs, agent_id, parent_message_id } = args;
      const body: MessageEnvelope = {
        type: 'text',
        text: content,
        agent_id: agent_id ?? null,
        parent_message_id: parent_message_id ?? null,
        refs: refs ?? [],
      };
      try {
        const result = await sdk.client.messaging.sendMessage({
          signer: sdk.keypair,
          groupRef: { uuid: channel_id },
          text: JSON.stringify(body),
        });
        return {
          message_id: result.messageId,
          channel_id,
          sender: sdk.keypair.toSuiAddress(),
          timestamp_ms: Date.now(),
        };
      } catch (e: unknown) {
        if (isInfraError(e)) {
          const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          // Queue the full validated args so resend can replay them verbatim.
          outbox.enqueue({ id, tool: 'channel.send', args });
          throw {
            code: 'RELAYER_UNREACHABLE',
            message: 'Queued to outbox',
            details: { outbox_id: id },
          };
        }
        throw e;
      }
    },
  };
}

export function historyTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelHistoryArgs>> {
  return {
    name: 'channel.history',
    description: 'Get message history of a channel',
    schema: ChannelHistoryArgs,
    handler: async ({ channel_id, since, limit }) => {
      // The plan's schema names this `since`, but the SDK paginates by
      // `afterOrder` (a numeric cursor over per-group message ordering). They
      // both denote "messages strictly after this point," so we map directly.
      // If we later need a wall-clock "since" we'll add a separate field and
      // do client-side filtering, but per-group order is the supported cursor.
      const { messages, hasNext } = await sdk.client.messaging.getMessages({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        limit,
        ...(since !== undefined ? { afterOrder: since } : {}),
      });
      const mapped = messages.map((m: DecryptedMessage) => {
        const body = tryParseEnvelope(m.text);
        const refs =
          'refs' in body && Array.isArray((body as MessageEnvelope).refs)
            ? (body as MessageEnvelope).refs
            : [];
        return {
          message_id: m.messageId,
          sender: m.senderAddress,
          timestamp_ms: m.createdAt,
          verified: m.senderVerified,
          order: m.order,
          body,
          refs,
        };
      });
      return {
        channel_id,
        messages: mapped,
        has_next: hasNext,
      };
    },
  };
}
