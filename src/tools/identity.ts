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

export function verifyTool(_sdk: SdkContext): ToolDef<z.infer<typeof IdentityVerifyArgs>> {
  return {
    name: 'identity.verify',
    description: "Verify a channel message's signature and return sender details",
    schema: IdentityVerifyArgs,
    handler: async (_args) => {
      throw {
        code: 'NOT_IMPLEMENTED',
        message: 'use channel.history for now; verify is finalized in T14',
      } as const;
    },
  };
}
