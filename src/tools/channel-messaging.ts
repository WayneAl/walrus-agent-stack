import { z } from 'zod';
import type {
  DecryptedMessage,
  GetMessagesOptions,
  GetMessagesResult,
  SendMessageOptions,
} from '@mysten/sui-stack-messaging';
import type { ToolDef } from '../mcp/dispatch.js';
import { ChannelSendArgs, ChannelHistoryArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';

/**
 * The SDK's messaging methods are generic over a `TApproveContext` parameter
 * (`void` by default). The default is preserved on the class itself, but it
 * is lost when we type `SdkContext.client` via `ReturnType<typeof
 * createSuiStackMessagingClient>` — TypeScript widens unbound generics to
 * `unknown`, which makes `WithApproveContext<T, unknown>` add a required
 * `sealApproveContext` field. Our config doesn't supply a custom seal policy,
 * so the `void` branch is the correct shape. We project the messaging surface
 * we use onto a narrow interface that locks `TApproveContext = void`.
 */
interface NarrowMessaging {
  sendMessage(options: SendMessageOptions<void>): Promise<{ messageId: string }>;
  getMessages(options: GetMessagesOptions<void>): Promise<GetMessagesResult>;
}

function messaging(sdk: SdkContext): NarrowMessaging {
  return sdk.client.messaging as unknown as NarrowMessaging;
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

export function sendTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelSendArgs>> {
  return {
    name: 'channel.send',
    description: 'Send a message to a channel; refs are Walrus URIs',
    schema: ChannelSendArgs,
    handler: async ({ channel_id, content, refs, agent_id, parent_message_id }) => {
      const body: MessageEnvelope = {
        type: 'text',
        text: content,
        agent_id: agent_id ?? null,
        parent_message_id: parent_message_id ?? null,
        refs: refs ?? [],
      };
      const result = await messaging(sdk).sendMessage({
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
      const { messages, hasNext } = await messaging(sdk).getMessages({
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
