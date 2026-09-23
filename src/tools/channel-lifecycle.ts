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
import { resolveChannelId, setActiveChannel, setCursor } from '../session.js';

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

/** Add members with the full messaging permission set (send, read, edit, delete). */
async function addFullMembers(sdk: SdkContext, groupId: string, addresses: string[]) {
  const perms = defaultMemberPermissionTypes(messagingOriginalPackageId(sdk.config.network));
  return sdk.client.groups.addMembers({
    signer: sdk.keypair,
    groupId,
    members: addresses.map((address) => ({
      address,
      permissions: [
        perms.MessagingSender,
        perms.MessagingReader,
        perms.MessagingEditor,
        perms.MessagingDeleter,
      ],
    })),
  });
}

export function createTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelCreateArgs>> {
  return {
    name: 'channel_create',
    description:
      'Create a new end-to-end encrypted channel for collaborating with other agents; you become its admin. ' +
      'Pass `members` (Sui addresses of the other agents) to invite them with full send/read permissions. ' +
      'The new channel becomes your active channel, so later channel_* / memory_* calls can omit channel_id. ' +
      'Share the returned channel_id with the other side so they can channel_join it.',
    schema: ChannelCreateArgs,
    handler: async ({ name, members = [] }) => {
      const uuid = globalThis.crypto.randomUUID();
      // No `initialMembers`: the SDK grants those Reader only. Members are
      // added below with the same full permission set channel_invite uses.
      const result = await sdk.client.messaging.createAndShareGroup({
        signer: sdk.keypair,
        name,
        uuid,
      });
      // Deterministically derive the on-chain group object ID from the UUID we
      // supplied. The SDK does the same derivation internally and exposes it
      // via `client.messaging.derive.groupId`.
      const groupId = sdk.client.messaging.derive.groupId({ uuid });
      setActiveChannel(sdk.config.home, uuid);
      setCursor(sdk.config.home, uuid, null); // brand-new channel: everything is new
      let inviteDigest: string | undefined;
      if (members.length > 0) {
        try {
          inviteDigest = (await addFullMembers(sdk, groupId, members)).digest;
        } catch (e: unknown) {
          throw {
            code: 'INVITE_FAILED',
            message: `Channel ${uuid} was created but inviting members failed; retry with channel_invite: ${
              e instanceof Error ? e.message : String(e)
            }`,
            details: { channel_id: uuid, members },
          };
        }
      }
      return {
        channel_id: uuid,
        group_id: groupId,
        digest: result.digest,
        admin: sdk.keypair.toSuiAddress(),
        invited: members,
        ...(inviteDigest ? { invite_digest: inviteDigest } : {}),
      };
    },
  };
}

export function membersTool(sdk: SdkContext): ToolDef<z.infer<typeof ChannelMembersArgs>> {
  return {
    name: 'channel_members',
    description:
      'List the members of a channel (default: the active channel) with their permissions.',
    schema: ChannelMembersArgs,
    handler: async (args) => {
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
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
    name: 'channel_invite',
    description:
      "Add another agent (by Sui address) to a channel (default: the active channel) with full send/read permissions. Admin only. The invitee then calls channel_join with the channel_id.",
    schema: ChannelInviteArgs,
    handler: async (args) => {
      const { address } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
      const groupId = sdk.client.messaging.derive.groupId({ uuid: channel_id });
      const result = await addFullMembers(sdk, groupId, [address]);
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
    name: 'channel_kick',
    description:
      'Remove a member from a channel (default: the active channel) and rotate the encryption key so they cannot read new messages. Admin only.',
    schema: ChannelKickArgs,
    handler: async (args) => {
      const { address } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
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
    name: 'channel_leave',
    description:
      'Leave a channel (default: the active channel); only this agent is removed.',
    schema: ChannelLeaveArgs,
    handler: async (args) => {
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
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
