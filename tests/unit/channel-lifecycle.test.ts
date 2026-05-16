import { describe, it, expect, vi, beforeEach } from 'vitest';
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
} {
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
    config: { network: 'testnet' },
    client: { messaging, groups },
  } as unknown as SdkContext;
  return { sdk, messaging, groups, address };
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
      'channel.create',
      'channel.members',
      'channel.invite',
      'channel.kick',
      'channel.leave',
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  it('channel.create generates a uuid, calls SDK with it, and returns the channel id', async () => {
    const tool = createTool(env.sdk);
    const res = (await tool.handler({ name: 'demo', members: ['0xbob'] })) as {
      channel_id: string;
      group_id: string;
      digest: string;
      admin: string;
    };
    expect(res.channel_id).toBeTruthy();
    expect(res.channel_id.length).toBeGreaterThan(8);
    expect(res.group_id).toBe(`0xderived-${res.channel_id}`);
    expect(res.digest).toBe('tx-digest-create');
    expect(res.admin).toBe(env.address);
    expect(env.messaging.createAndShareGroup).toHaveBeenCalledTimes(1);
    const call = env.messaging.createAndShareGroup.mock.calls[0]![0];
    expect(call.name).toBe('demo');
    expect(call.uuid).toBe(res.channel_id);
    expect(call.initialMembers).toEqual(['0xbob']);
    expect(call.signer).toBe(env.sdk.keypair);
  });

  it('channel.create defaults initialMembers to []', async () => {
    const tool = createTool(env.sdk);
    await tool.handler({ name: 'no-members' });
    const call = env.messaging.createAndShareGroup.mock.calls[0]![0];
    expect(call.initialMembers).toEqual([]);
  });

  it('channel.members returns filtered members from groups.view.getMembers', async () => {
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

  it('channel.invite calls groups.addMembers with the right shape and permissions', async () => {
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

  it('channel.kick calls messaging.removeMembersAndRotateKey with members=[address]', async () => {
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

  it('channel.leave calls messaging.leave with the derived groupId', async () => {
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
