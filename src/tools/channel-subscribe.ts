import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import { ChannelJoinArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';

/**
 * `channel.join` is the MCP-friendly stand-in for `channel.subscribe`.
 *
 * The SDK's live `subscribe` returns an AsyncIterable, which doesn't map onto
 * MCP's request/response shape. Instead we pull a snapshot of recent history
 * here — this both confirms membership + decrypt access and primes the caller
 * with the latest messages. Agents are expected to poll `channel.history`
 * with the returned cursor when they need to advance.
 *
 * The plan draft read `messages.length` directly on the awaited value, but
 * `getMessages` actually resolves to `{ messages, hasNext }`. We surface
 * `hasNext` as `has_next` so callers know whether to keep paging.
 */
export function joinTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelJoinArgs>> {
  return {
    name: 'channel.join',
    description:
      'Subscribe to a channel (pulls history immediately; live stream not exposed via MCP)',
    schema: ChannelJoinArgs,
    handler: async ({ channel_id }) => {
      const { messages, hasNext } = await sdk.client.messaging.getMessages({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        limit: 100,
      });
      return {
        channel_id,
        joined_as: sdk.keypair.toSuiAddress(),
        history_count: messages.length,
        has_next: hasNext,
      };
    },
  };
}
