import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { whoamiTool, verifyTool } from '../../src/tools/identity.js';

describe('identity tools', () => {
  const keypair = new Ed25519Keypair();
  // Partial mock — these tools never touch sdk.client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = { keypair, config: { network: 'testnet' } } as any;

  it('whoami returns the keypair address and network', async () => {
    const tool = whoamiTool(sdk);
    const res = await tool.handler({});
    expect(res).toEqual({
      address: keypair.toSuiAddress(),
      network: 'testnet',
    });
  });

  it('verify rejects with NOT_IMPLEMENTED', async () => {
    const tool = verifyTool(sdk);
    await expect(tool.handler({ message_id: 'x' })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('tools expose correct name and non-empty description', () => {
    const whoami = whoamiTool(sdk);
    const verify = verifyTool(sdk);
    expect(whoami.name).toBe('identity.whoami');
    expect(verify.name).toBe('identity.verify');
    expect(whoami.description).toBeTruthy();
    expect(verify.description).toBeTruthy();
  });
});
