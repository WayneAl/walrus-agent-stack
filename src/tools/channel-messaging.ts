import { z } from 'zod';
import type { DecryptedMessage } from '@mysten/sui-stack-messaging';
import type { ToolDef } from '../mcp/dispatch.js';
import { ChannelSendArgs, ChannelHistoryArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';
import type { Outbox } from '../outbox.js';
import { RateLimiter } from '../rate-limiter.js';
import { LoopDetector } from '../loop-detector.js';
import { isInfraError } from '../errors.js';
import { resolveChannelId } from '../session.js';

/**
 * Module-level guards applied to channel_send: cap sustained per-channel send
 * volume and detect a single sender flooding back-to-back messages. Both are
 * hard rejections — they do NOT enqueue to the outbox (that path is reserved
 * for transient infra failures like RELAYER_UNREACHABLE). The loop threshold
 * is high enough for an agent answering a batch of tasks in a row.
 */
const LOOP_THRESHOLD = 20;
const sendRateLimiter = new RateLimiter(10, 60_000);
const loopDetector = new LoopDetector(LOOP_THRESHOLD);

/**
 * Test-only: reset both module-level limiters so cases don't bleed state
 * across `beforeEach` boundaries. Not part of the public tool surface.
 */
export function _resetSendLimitersForTests(): void {
  sendRateLimiter.reset();
  loopDetector.reset();
}

/**
 * Test-only: reset just the loop detector. Used by the rate-limiter wiring
 * test, which needs to drive same-key sends through the handler without
 * the loop detector interfering (both limiters share the same
 * composite key). Not part of the public tool surface.
 */
export function _resetLoopDetectorForTests(): void {
  loopDetector.reset();
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
 * into a JSON envelope and stuff it into `text`. `channel_history` parses the
 * envelope back out, falling back to a plain-text representation when a
 * message wasn't sent by us. Once T11/T12 land we can migrate selectively.
 */
interface MessageEnvelope {
  type: 'text';
  text: string;
  agent_id: string | null;
  parent_message_id: string | null;
  refs: string[];
  /** Addressee: a Sui address, `*` for everyone, or null (unaddressed). */
  to: string | null;
  intent: 'task' | 'result' | 'chat' | 'done' | null;
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

/** Tool-facing shape of a decrypted message (shared by history, join and wait). */
export function mapMessage(m: DecryptedMessage) {
  const body = tryParseEnvelope(m.text);
  const env = body as Partial<MessageEnvelope>;
  return {
    message_id: m.messageId,
    sender: m.senderAddress,
    timestamp_ms: m.createdAt,
    verified: m.senderVerified,
    order: m.order,
    to: env.to ?? null,
    intent: env.intent ?? null,
    body,
    refs: Array.isArray(env.refs) ? env.refs : [],
  };
}

export function sendTool(
  sdk: SdkContext,
  outbox: Outbox,
): ToolDef<z.infer<typeof ChannelSendArgs>> {
  return {
    name: 'channel_send',
    description:
      'Send an encrypted, signed message to a channel (default: the active channel). ' +
      "Set `to` (a member's Sui address, or '*') and `intent` so the other agent knows what is expected: " +
      "'task' asks the addressee to do something, 'result' answers a task, 'chat' is discussion, 'done' ends the collaboration. " +
      'For large content, store it with memory_write first and pass the returned URI in `refs`.',
    schema: ChannelSendArgs,
    handler: async (args) => {
      const { content, refs, agent_id, parent_message_id, to, intent } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
      // Rate-limit + loop-detect run BEFORE envelope construction and BEFORE
      // the SDK call. They throw plain-object errors that bypass the outbox
      // try/catch below — these are hard rejections, not transient infra
      // failures, so they must not enqueue.
      const limiterKey = `${channel_id}:${sdk.keypair.toSuiAddress()}`;
      if (!sendRateLimiter.check(limiterKey)) {
        throw { code: 'RATE_LIMITED', message: '>10 msgs/min on this channel' };
      }
      if (loopDetector.observe(limiterKey)) {
        throw {
          code: 'LOOP_DETECTED',
          message: `Same sender ${LOOP_THRESHOLD}+ times in a row; pausing`,
        };
      }
      const body: MessageEnvelope = {
        type: 'text',
        text: content,
        agent_id: agent_id ?? null,
        parent_message_id: parent_message_id ?? null,
        refs: refs ?? [],
        to: to ?? null,
        intent: intent ?? null,
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
          // Queue the validated args (with the resolved channel) so resend
          // replays them verbatim even if the active channel changes.
          outbox.enqueue({ id, tool: 'channel_send', args: { ...args, channel_id } });
          const walrus = (e as { code?: unknown }).code === 'WALRUS_UNAVAILABLE';
          throw {
            code: walrus ? 'WALRUS_UNAVAILABLE' : 'RELAYER_UNREACHABLE',
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
    name: 'channel_history',
    description:
      'Read messages of a channel (default: the active channel), oldest first. ' +
      'Pass `since` (an `order` from a previous result) to page forward. ' +
      'To wait for new messages from other agents use channel_wait instead.',
    schema: ChannelHistoryArgs,
    handler: async (args) => {
      const { since, limit } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
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
      return {
        channel_id,
        messages: messages.map(mapMessage),
        has_next: hasNext,
      };
    },
  };
}
