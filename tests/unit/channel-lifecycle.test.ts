import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG } from '@mysten/sui-stack-messaging';
import {
  createTool,
  membersTool,
  inviteTool,
  kickTool,
  leaveTool,
} from '../../src/tools/channel-lifecycle.js';
import type { SdkContext } from '../../src/sdk-client.js';
import { getCursor, readSession, setActiveChannel } from '../../src/session.js';

interface MockMessaging {
  createAndShareGroup: ReturnType<typeof vi.fn>;
  removeMembersAndRotateKey: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  derive: {
    groupId: ReturnType<typeof vi.fn>;
    systemObjectAddresses: ReturnType<typeof vi.fn>;
  };
}

interface MockGroups {
  addMembers: ReturnType<typeof vi.fn>;
  view: {
    getMembers: ReturnType<typeof vi.fn>;
  };
}

function makeMockSdk(): {
  sdk: SdkContext;
  messaging: MockMessaging;
  groups: MockGroups;
  address: string;
  home: string;
} {
  const home = mkdtempSync(join(tmpdir(), 'wa-life-'));
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const messaging: MockMessaging = {
    createAndShareGroup: vi.fn(async () => ({ digest: 'tx-digest-create', effects: {} })),
    removeMembersAndRotateKey: vi.fn(async () => ({ digest: 'tx-digest-kick', effects: {} })),
    leave: vi.fn(async () => ({ digest: 'tx-digest-leave', effects: {} })),
    derive: {
      groupId: vi.fn(({ uuid }: { uuid: string }) => `0xderived-${uuid}`),
      systemObjectAddresses: vi.fn(() => new Set<string>(['0xsystem-leaver', '0xsystem-manager'])),
    },
  };
  const groups: MockGroups = {
    addMembers: vi.fn(async () => ({ digest: 'tx-digest-invite', effects: {} })),
    view: {
      getMembers: vi.fn(async () => ({
        members: [
          { address: '0xalice', permissions: ['perm.Reader'] },
          { address: '0xsystem-leaver', permissions: ['perm.Admin'] },
        ],
        hasNextPage: false,
        cursor: null,
      })),
    },
  };
  const sdk = {
    keypair,
    config: { network: 'testnet', home },
    client: { messaging, groups },
  } as unknown as SdkContext;
  return { sdk, messaging, groups, address, home };
}

describe('channel lifecycle tools', () => {
  let env: ReturnType<typeof makeMockSdk>;
  beforeEach(() => {
    env = makeMockSdk();
  });

  it('all tools expose correct names and non-empty descriptions', () => {
    const tools = [
      createTool(env.sdk),
      membersTool(env.sdk),
      inviteTool(env.sdk),
      kickTool(env.sdk),
      leaveTool(env.sdk),
    ];
    expect(tools.map((t) => t.name)).toEqual([
      'channel_create',
      'channel_members',
      'channel_invite',
      'channel_kick',
      'channel_leave',
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  it('channel_create creates without initialMembers, then invites members with full perms', async () => {
    const tool = createTool(env.sdk);
    const res = (await tool.handler({ name: 'demo', members: ['0xb0b', '0xca401'] })) as {
      channel_id: string;
      group_id: string;
      digest: string;
      admin: string;
      invited: string[];
      invite_digest: string;
    };
    expect(res.channel_id).toBeTruthy();
    expect(res.channel_id.length).toBeGreaterThan(8);
    expect(res.group_id).toBe(`0xderived-${res.channel_id}`);
    expect(res.digest).toBe('tx-digest-create');
    expect(res.admin).toBe(env.address);
    expect(res.invited).toEqual(['0xb0b', '0xca401']);
    expect(res.invite_digest).toBe('tx-digest-invite');
    expect(env.messaging.createAndShareGroup).toHaveBeenCalledTimes(1);
    const call = env.messaging.createAndShareGroup.mock.calls[0]![0];
    expect(call.name).toBe('demo');
    expect(call.uuid).toBe(res.channel_id);
    // initialMembers would only grant Reader — members go through addMembers instead.
    expect(call.initialMembers).toBeUndefined();
    expect(call.signer).toBe(env.sdk.keypair);

    expect(env.groups.addMembers).toHaveBeenCalledTimes(1);
    const inv = env.groups.addMembers.mock.calls[0]![0];
    expect(inv.groupId).toBe(res.group_id);
    const pkg = TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId;
    const full = ['Sender', 'Reader', 'Editor', 'Deleter'].map((p) => `${pkg}::messaging::Messaging${p}`);
    expect(inv.members).toEqual([
      { address: '0xb0b', permissions: full },
      { address: '0xca401', permissions: full },
    ]);
    // Create-before-invite ordering.
    expect(env.messaging.createAndShareGroup.mock.invocationCallOrder[0]!).toBeLessThan(
      env.groups.addMembers.mock.invocationCallOrder[0]!,
    );

    // The new channel is active, with a from-the-start cursor.
    expect(readSession(env.home).active_channel_id).toBe(res.channel_id);
    expect(getCursor(env.home, res.channel_id)).toBeNull();
  });

  it('channel_create with no members skips addMembers', async () => {
    const tool = createTool(env.sdk);
    const res = (await tool.handler({ name: 'no-members' })) as { invited: string[] };
    expect(res.invited).toEqual([]);
    expect(env.groups.addMembers).not.toHaveBeenCalled();
  });

  it('channel_create reports INVITE_FAILED with the channel id when the invite tx fails', async () => {
    env.groups.addMembers.mockRejectedValueOnce(new Error('boom'));
    const tool = createTool(env.sdk);
    await expect(tool.handler({ name: 'x', members: ['0xb0b'] })).rejects.toMatchObject({
      code: 'INVITE_FAILED',
      details: { channel_id: expect.any(String) },
    });
    // The channel exists on-chain, so it is still made active.
    expect(readSession(env.home).active_channel_id).toBeTruthy();
  });

  it('channel_members defaults to the active channel', async () => {
    setActiveChannel(env.home, 'uuid-active');
    const tool = membersTool(env.sdk);
    await tool.handler({});
    expect(env.groups.view.getMembers).toHaveBeenCalledWith({
      groupId: '0xderived-uuid-active',
      exhaustive: true,
    });
  });

  it('throws NO_ACTIVE_CHANNEL when channel_id is omitted and none is active', async () => {
    const tool = leaveTool(env.sdk);
    await expect(tool.handler({})).rejects.toMatchObject({ code: 'NO_ACTIVE_CHANNEL' });
    expect(env.messaging.leave).not.toHaveBeenCalled();
  });

  it('channel_members returns filtered members from groups.view.getMembers', async () => {
    const tool = membersTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-1' })) as {
      channel_id: string;
      group_id: string;
      members: { address: string; permissions: string[] }[];
    };
    expect(env.groups.view.getMembers).toHaveBeenCalledWith({
      groupId: '0xderived-uuid-1',
      exhaustive: true,
    });
    expect(res.channel_id).toBe('uuid-1');
    expect(res.group_id).toBe('0xderived-uuid-1');
    // System addresses should be filtered out.
    expect(res.members).toEqual([{ address: '0xalice', permissions: ['perm.Reader'] }]);
  });

  it('channel_invite calls groups.addMembers with the right shape and permissions', async () => {
    const tool = inviteTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-2', address: '0xcarol' })) as {
      channel_id: string;
      group_id: string;
      invited: string;
      digest: string;
    };
    expect(res).toEqual({
      channel_id: 'uuid-2',
      group_id: '0xderived-uuid-2',
      invited: '0xcarol',
      digest: 'tx-digest-invite',
    });
    expect(env.groups.addMembers).toHaveBeenCalledTimes(1);
    const call = env.groups.addMembers.mock.calls[0]![0];
    expect(call.signer).toBe(env.sdk.keypair);
    expect(call.groupId).toBe('0xderived-uuid-2');
    expect(call.members).toHaveLength(1);
    expect(call.members[0].address).toBe('0xcarol');
    // Should grant the four default messaging permissions, derived from the
    // testnet messaging package id.
    const pkg = TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG.originalPackageId;
    expect(call.members[0].permissions).toEqual([
      `${pkg}::messaging::MessagingSender`,
      `${pkg}::messaging::MessagingReader`,
      `${pkg}::messaging::MessagingEditor`,
      `${pkg}::messaging::MessagingDeleter`,
    ]);
  });

  it('channel_kick calls messaging.removeMembersAndRotateKey with members=[address]', async () => {
    const tool = kickTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-3', address: '0xeve' })) as {
      channel_id: string;
      kicked: string;
      key_rotated: boolean;
      digest: string;
    };
    expect(res).toEqual({
      channel_id: 'uuid-3',
      kicked: '0xeve',
      key_rotated: true,
      digest: 'tx-digest-kick',
    });
    expect(env.messaging.removeMembersAndRotateKey).toHaveBeenCalledTimes(1);
    const call = env.messaging.removeMembersAndRotateKey.mock.calls[0]![0];
    expect(call.signer).toBe(env.sdk.keypair);
    expect(call.uuid).toBe('uuid-3');
    expect(call.members).toEqual(['0xeve']);
  });

  it('channel_leave calls messaging.leave with the derived groupId', async () => {
    const tool = leaveTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-4' })) as {
      channel_id: string;
      group_id: string;
      left: string;
      digest: string;
    };
    expect(res).toEqual({
      channel_id: 'uuid-4',
      group_id: '0xderived-uuid-4',
      left: env.address,
      digest: 'tx-digest-leave',
    });
    expect(env.messaging.leave).toHaveBeenCalledTimes(1);
    const call = env.messaging.leave.mock.calls[0]![0];
    expect(call.signer).toBe(env.sdk.keypair);
    expect(call.groupId).toBe('0xderived-uuid-4');
  });
});
