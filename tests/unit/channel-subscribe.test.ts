import { describe, it, expect, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { joinTool } from '../../src/tools/channel-subscribe.js';
import type { SdkContext } from '../../src/sdk-client.js';

interface MockMessaging {
  getMessages: ReturnType<typeof vi.fn>;
}

function makeMockSdk(getMessagesResult: { messages: unknown[]; hasNext: boolean }): {
  sdk: SdkContext;
  messaging: MockMessaging;
  address: string;
} {
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const messaging: MockMessaging = {
    getMessages: vi.fn(async () => getMessagesResult),
  };
  const sdk = {
    keypair,
    config: { network: 'testnet' },
    client: { messaging },
  } as unknown as SdkContext;
  return { sdk, messaging, address };
}

describe('channel.join tool', () => {
  it('exposes correct name and non-empty description', () => {
    const { sdk } = makeMockSdk({ messages: [], hasNext: false });
    const tool = joinTool(sdk);
    expect(tool.name).toBe('channel.join');
    expect(tool.description).toBeTruthy();
  });

  it('returns history_count + joined_as for a non-empty history with hasNext=false', async () => {
    const env = makeMockSdk({
      messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      hasNext: false,
    });
    const tool = joinTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-join-1' })) as {
      channel_id: string;
      joined_as: string;
      history_count: number;
      has_next: boolean;
    };
    expect(res).toEqual({
      channel_id: 'uuid-join-1',
      joined_as: env.address,
      history_count: 3,
      has_next: false,
    });
  });

  it('returns history_count=0 and has_next=true for an empty page with more pending', async () => {
    const env = makeMockSdk({ messages: [], hasNext: true });
    const tool = joinTool(env.sdk);
    const res = (await tool.handler({ channel_id: 'uuid-join-2' })) as {
      channel_id: string;
      joined_as: string;
      history_count: number;
      has_next: boolean;
    };
    expect(res.history_count).toBe(0);
    expect(res.has_next).toBe(true);
    expect(res.channel_id).toBe('uuid-join-2');
    expect(res.joined_as).toBe(env.address);
  });

  it('calls getMessages with signer, groupRef.uuid, and limit=100', async () => {
    const env = makeMockSdk({ messages: [], hasNext: false });
    const tool = joinTool(env.sdk);
    await tool.handler({ channel_id: 'uuid-join-3' });
    expect(env.messaging.getMessages).toHaveBeenCalledTimes(1);
    const call = env.messaging.getMessages.mock.calls[0]![0];
    expect(call.signer).toBe(env.sdk.keypair);
    expect(call.groupRef).toEqual({ uuid: 'uuid-join-3' });
    expect(call.limit).toBe(100);
  });
});
