import { z } from 'zod';
import {
  TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG,
  MAINNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG,
  defaultMemberPermissionTypes,
} from '@mysten/sui-stack-messaging';
import type { ToolDef } from '../mcp/dispatch.js';
import {
  ChannelCreateArgs,
  ChannelMembersArgs,
  ChannelInviteArgs,
  ChannelKickArgs,
  ChannelLeaveArgs,
} from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';

/**
 * Returns the original (V1) package ID of the messaging Move package for the
 * configured network. Required for forming `defaultMemberPermissionTypes` strings
 * — those types live in the messaging package, not in sui-groups, so the groups
 * client cannot infer them.
 */
function messagingOriginalPackageId(network: 'mainnet' | 'testnet'): string {
  return network === 'mainnet'
    ? MAINNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId
    : TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId;
}

export function createTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelCreateArgs>> {
  return {
    name: 'channel.create',
    description: 'Create a new encrypted channel; caller becomes admin',
    schema: ChannelCreateArgs,
    handler: async ({ name, members = [] }) => {
      const uuid = globalThis.crypto.randomUUID();
      const result = await sdk.client.messaging.createAndShareGroup({
        signer: sdk.keypair,
        name,
        uuid,
        initialMembers: members,
      });
      // Deterministically derive the on-chain group object ID from the UUID we
      // supplied. The SDK does the same derivation internally and exposes it
      // via `client.messaging.derive.groupId`.
      const groupId = sdk.client.messaging.derive.groupId({ uuid });
      return {
        channel_id: uuid,
        group_id: groupId,
        digest: result.digest,
        admin: sdk.keypair.toSuiAddress(),
      };
    },
  };
}

export function membersTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelMembersArgs>> {
  return {
    name: 'channel.members',
    description: 'List members of a channel',
    schema: ChannelMembersArgs,
    handler: async ({ channel_id }) => {
      const groupId = sdk.client.messaging.derive.groupId({ uuid: channel_id });
      // `client.groups.view.getMembers` returns `{ members: [{ address, permissions }], hasNextPage, cursor }`.
      // We use `exhaustive: true` to paginate transparently — caller gets the full set.
      const page = await sdk.client.groups.view.getMembers({
        groupId,
        exhaustive: true,
      });
      // Filter out the GroupLeaver / GroupManager singleton system addresses so
      // callers see only real members.
      const system = sdk.client.messaging.derive.systemObjectAddresses();
      const members = page.members
        .filter((m) => !system.has(m.address))
        .map((m) => ({ address: m.address, permissions: m.permissions }));
      return {
        channel_id,
        group_id: groupId,
        members,
      };
    },
  };
}

export function inviteTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelInviteArgs>> {
  return {
    name: 'channel.invite',
    description: 'Add a member to a channel with default messaging permissions',
    schema: ChannelInviteArgs,
    handler: async ({ channel_id, address }) => {
      const groupId = sdk.client.messaging.derive.groupId({ uuid: channel_id });
      const pkgId = messagingOriginalPackageId(sdk.config.network);
      const perms = defaultMemberPermissionTypes(pkgId);
      const result = await sdk.client.groups.addMembers({
        signer: sdk.keypair,
        groupId,
        members: [
          {
            address,
            permissions: [
              perms.MessagingSender,
              perms.MessagingReader,
              perms.MessagingEditor,
              perms.MessagingDeleter,
            ],
          },
        ],
      });
      return {
        channel_id,
        group_id: groupId,
        invited: address,
        digest: result.digest,
      };
    },
  };
}

export function kickTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelKickArgs>> {
  return {
    name: 'channel.kick',
    description: 'Remove a member and rotate the channel encryption key',
    schema: ChannelKickArgs,
    handler: async ({ channel_id, address }) => {
      const result = await sdk.client.messaging.removeMembersAndRotateKey({
        signer: sdk.keypair,
        uuid: channel_id,
        members: [address],
      });
      return {
        channel_id,
        kicked: address,
        key_rotated: true,
        digest: result.digest,
      };
    },
  };
}

export function leaveTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelLeaveArgs>> {
  return {
    name: 'channel.leave',
    description: 'Leave a channel; only the calling agent is removed',
    schema: ChannelLeaveArgs,
    handler: async ({ channel_id }) => {
      const groupId = sdk.client.messaging.derive.groupId({ uuid: channel_id });
      const result = await sdk.client.messaging.leave({
        signer: sdk.keypair,
        groupId,
      });
      return {
        channel_id,
        group_id: groupId,
        left: sdk.keypair.toSuiAddress(),
        digest: result.digest,
      };
    },
  };
}
