/**
 * Request testnet funds for a given address. Tries the v2 faucet endpoint
 * first and falls back to v1 on 404 (matching scripts/gen-testnet-wallet.ts).
 *
 * Waits 3s after a successful request so the new coin object becomes visible
 * to subsequent RPC reads.
 */
const FAUCET_V2 = 'https://faucet.testnet.sui.io/v2/gas';
const FAUCET_V1 = 'https://faucet.testnet.sui.io/gas';

export async function fundFromFaucet(address: string): Promise<void> {
  const body = JSON.stringify({ FixedAmountRequest: { recipient: address } });
  const endpoints = [FAUCET_V2, FAUCET_V1];
  let lastErr: string | undefined;
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      // Wait for the gas object to be visible on RPC.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return;
    }
    if (res.status === 404) {
      lastErr = `${url} -> 404`;
      continue;
    }
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`Faucet ${url} failed: ${res.status} ${text}`);
  }
  throw new Error(`Faucet failed on all endpoints: ${lastErr ?? 'unknown'}`);
}
