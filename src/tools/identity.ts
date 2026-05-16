import { z } from 'zod';
import type { ToolDef } from '../mcp/dispatch.js';
import { EmptyArgs, IdentityVerifyArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';

export function whoamiTool(sdk: SdkContext): ToolDef<z.infer<typeof EmptyArgs>> {
  return {
    name: 'identity.whoami',
    description: "Return this MCP server's Sui address",
    schema: EmptyArgs,
    handler: async () => ({
      address: sdk.keypair.toSuiAddress(),
      network: sdk.config.network,
    }),
  };
}

export function verifyTool(sdk: SdkContext): ToolDef<z.infer<typeof IdentityVerifyArgs>> {
  return {
    name: 'identity.verify',
    description: "Verify a channel message's signature and return sender details",
    schema: IdentityVerifyArgs,
    handler: async ({ message_id, channel_id }) => {
      // The SDK exposes a direct `getMessage` lookup keyed by groupRef +
      // messageId, which is far cheaper than scanning a history page. The
      // `senderVerified` flag on `DecryptedMessage` is the SDK's own
      // signature-verification result, so we surface that directly rather than
      // reimplementing crypto here. There is no `signature` / `payloadHash`
      // field on the decrypted shape — those live behind the SDK's verifier.
      let msg;
      try {
        msg = await sdk.client.messaging.getMessage({
          signer: sdk.keypair,
          groupRef: { uuid: channel_id },
          messageId: message_id,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        throw {
          code: 'MESSAGE_NOT_FOUND',
          message: `No message ${message_id} in channel ${channel_id}: ${message}`,
        };
      }
      if (!msg) {
        throw {
          code: 'MESSAGE_NOT_FOUND',
          message: `No message ${message_id} in channel ${channel_id}`,
        };
      }
      return {
        message_id: msg.messageId,
        channel_id,
        sender: msg.senderAddress,
        verified: msg.senderVerified,
        timestamp_ms: msg.createdAt,
        order: msg.order,
      };
    },
  };
}
