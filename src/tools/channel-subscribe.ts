import { z } from 'zod';
import type { DecryptedMessage } from '@mysten/sui-stack-messaging';
import type { ToolDef } from '../mcp/dispatch.js';
import { ChannelJoinArgs, ChannelWaitArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';
import { getCursor, resolveChannelId, setActiveChannel, setCursor } from '../session.js';
import { mapMessage } from './channel-messaging.js';

const JOIN_RECENT = 20;
const PAGE_LIMIT = 100;

/**
 * Page forward from `after` (null = from the start) to the end of the channel.
 * `keepLast` bounds what is retained; `last` is the highest order seen (or
 * `after` when nothing new). Neither transport exposes "latest N", so reaching
 * the tail means walking forward.
 */
async function readForward(
  sdk: SdkContext,
  uuid: string,
  after: number | null,
  keepLast = Infinity,
): Promise<{ messages: DecryptedMessage[]; last: number | null; total: number }> {
  let cursor = after;
  let kept: DecryptedMessage[] = [];
  let total = 0;
  for (;;) {
    const { messages, hasNext } = await sdk.client.messaging.getMessages({
      signer: sdk.keypair,
      groupRef: { uuid },
      limit: PAGE_LIMIT,
      ...(cursor !== null ? { afterOrder: cursor } : {}),
    });
    total += messages.length;
    kept = kept.concat(messages);
    if (kept.length > keepLast) kept = keepLast > 0 ? kept.slice(-keepLast) : [];
    const tail = messages[messages.length - 1];
    if (tail) cursor = tail.order;
    if (!hasNext || !tail) break;
  }
  return { messages: kept, last: cursor, total };
}

/**
 * `channel_join` makes a channel active and primes the agent with context.
 *
 * The SDK's live `subscribe` returns an AsyncIterable, which doesn't map onto
 * MCP's request/response shape; `channel_wait` is the MCP-friendly long-poll.
 * Join returns the most recent messages and moves the stored cursor to the
 * newest one, so the next `channel_wait` returns only what arrives afterwards.
 */
export function joinTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelJoinArgs>> {
  return {
    name: 'channel_join',
    description:
      'Join a channel you were invited to (by its channel_id) and make it your active channel. ' +
      `Returns the ${JOIN_RECENT} most recent messages for context; afterwards call channel_wait to receive new messages.`,
    schema: ChannelJoinArgs,
    handler: async ({ channel_id }) => {
      const { messages, last, total } = await readForward(sdk, channel_id, null, JOIN_RECENT);
      setActiveChannel(sdk.config.home, channel_id);
      setCursor(sdk.config.home, channel_id, last);
      return {
        channel_id,
        joined_as: sdk.keypair.toSuiAddress(),
        history_count: total,
        messages: messages.map(mapMessage),
      };
    },
  };
}

export interface WaitOptions {
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * `channel_wait` long-polls `getMessages(afterOrder = cursor)` until a message
 * from someone else arrives (or `include_own`) or the timeout passes. The
 * cursor lives in session.json and advances past everything read, own
 * messages included, so each message is delivered once.
 */
export function waitTool(
  sdk: SdkContext,
  opts: WaitOptions = {},
): ToolDef<z.infer<typeof ChannelWaitArgs>> {
  const pollMs = opts.pollMs ?? 3_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  return {
    name: 'channel_wait',
    description:
      'Wait (up to timeout_s, max 50 s) for new messages from other agents on a channel (default: the active channel). ' +
      'Returns each new message once, oldest first, with sender, `to`, `intent`, text and refs; `timed_out: true` means nothing arrived — call it again to keep listening. ' +
      'Use this in a loop to listen for tasks and replies instead of polling channel_history.',
    schema: ChannelWaitArgs,
    handler: async (args) => {
      const { timeout_s, include_own } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
      const me = sdk.keypair.toSuiAddress();
      let cursor = getCursor(sdk.config.home, channel_id);
      if (cursor === undefined) {
        // Never read this channel: start at its current tail (future messages only).
        cursor = (await readForward(sdk, channel_id, null, 0)).last;
        setCursor(sdk.config.home, channel_id, cursor);
      }
      const deadline = now() + timeout_s * 1000;
      for (;;) {
        const { messages, last } = await readForward(sdk, channel_id, cursor);
        if (last !== cursor) {
          cursor = last;
          setCursor(sdk.config.home, channel_id, cursor);
        }
        const relevant = include_own ? messages : messages.filter((m) => m.senderAddress !== me);
        if (relevant.length > 0) {
          return { channel_id, messages: relevant.map(mapMessage), timed_out: false };
        }
        if (now() + pollMs > deadline) {
          return { channel_id, messages: [], timed_out: true };
        }
        await sleep(pollMs);
      }
    },
  };
}
