import { describe, it, expect, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { whoamiTool, verifyTool } from '../../src/tools/identity.js';
import type { SdkContext } from '../../src/sdk-client.js';

interface MockMessaging {
  getMessage: ReturnType<typeof vi.fn>;
}

function makeSdk(getMessageImpl?: (...args: unknown[]) => unknown): {
  sdk: SdkContext;
  messaging: MockMessaging;
  keypair: Ed25519Keypair;
} {
  const keypair = new Ed25519Keypair();
  const messaging: MockMessaging = {
    getMessage: vi.fn(getMessageImpl ?? (async () => ({}))),
  };
  const sdk = {
    keypair,
    config: { network: 'testnet' },
    client: { messaging },
  } as unknown as SdkContext;
  return { sdk, messaging, keypair };
}

describe('identity tools', () => {
  it('whoami returns the keypair address and network', async () => {
    const { sdk, keypair } = makeSdk();
    const tool = whoamiTool(sdk);
    const res = await tool.handler({});
    expect(res).toEqual({
      address: keypair.toSuiAddress(),
      network: 'testnet',
    });
  });

  it('verify returns sender + verified flag from getMessage', async () => {
    const decrypted = {
      messageId: 'msg-1',
      groupId: 'g-1',
      order: 4,
      text: 'hi',
      senderAddress: '0xalice',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      isEdited: false,
      isDeleted: false,
      attachments: [],
      senderVerified: true,
    };
    const { sdk, messaging, keypair } = makeSdk(async () => decrypted);
    const tool = verifyTool(sdk);
    const res = (await tool.handler({ message_id: 'msg-1', channel_id: 'chan-1' })) as {
      message_id: string;
      channel_id: string;
      sender: string;
      verified: boolean;
      timestamp_ms: number;
      order: number;
    };

    expect(messaging.getMessage).toHaveBeenCalledTimes(1);
    const call = messaging.getMessage.mock.calls[0]![0];
    expect(call.signer).toBe(keypair);
    expect(call.groupRef).toEqual({ uuid: 'chan-1' });
    expect(call.messageId).toBe('msg-1');

    expect(res).toEqual({
      message_id: 'msg-1',
      channel_id: 'chan-1',
      sender: '0xalice',
      verified: true,
      timestamp_ms: 1_700_000_000_000,
      order: 4,
    });
  });

  it('verify maps a thrown getMessage error to MESSAGE_NOT_FOUND', async () => {
    const { sdk } = makeSdk(async () => {
      throw new Error('not found');
    });
    const tool = verifyTool(sdk);
    await expect(
      tool.handler({ message_id: 'missing', channel_id: 'chan-x' }),
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
  });

  it('verify maps a null getMessage result to MESSAGE_NOT_FOUND', async () => {
    const { sdk } = makeSdk(async () => null);
    const tool = verifyTool(sdk);
    await expect(
      tool.handler({ message_id: 'missing', channel_id: 'chan-x' }),
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
  });

  it('tools expose correct name and non-empty description', () => {
    const { sdk } = makeSdk();
    const whoami = whoamiTool(sdk);
    const verify = verifyTool(sdk);
    expect(whoami.name).toBe('identity.whoami');
    expect(verify.name).toBe('identity.verify');
    expect(whoami.description).toBeTruthy();
    expect(verify.description).toBeTruthy();
  });
});
