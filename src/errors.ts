import type { ToolError } from './mcp/dispatch.js';

export function webFaucetUrl(address: string): string {
  return `https://faucet.sui.io/?address=${address}`;
}

interface ErrorFields {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

/**
 * Walrus / network failures worth queueing to the outbox. Matches the
 * transport's `WALRUS_UNAVAILABLE` (503) plus the substrings Node + fetch
 * surface when an endpoint is unreachable. We deliberately do NOT match generic
 * "5" digit sequences (which would misclassify e.g. a payload size `length=5`).
 */
export function isInfraError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { status, code } = e as ErrorFields;
  if (code === 'WALRUS_UNAVAILABLE' || status === 503) return true;
  if (!(e instanceof Error)) return false;
  const stack = `${e.message}\n${e.stack ?? ''}`.toLowerCase();
  return (
    stack.includes('econnrefused') ||
    stack.includes('fetch failed') ||
    stack.includes('enotfound') ||
    stack.includes('etimedout') ||
    stack.includes('network is unreachable') ||
    stack.includes('socket hang up')
  );
}

/**
 * Map transport / chain errors onto stable tool error codes: 403 → the caller
 * lacks the group permission; 402 or an out-of-gas chain error → the wallet
 * needs SUI. Returns null for anything else so the caller keeps its default.
 */
export function mapSdkError(
  e: unknown,
  ctx: { address: string; network: 'mainnet' | 'testnet' },
): ToolError | null {
  if (typeof e !== 'object' || e === null) return null;
  const { status, code } = e as ErrorFields;
  const message = e instanceof Error ? e.message : String((e as ErrorFields).message ?? '');
  if (status === 403 || code === 'NOT_GROUP_MEMBER') {
    return {
      code: 'NOT_GROUP_MEMBER',
      message: `${ctx.address} is not a member of this channel (or lacks send permission); ask the channel admin to channel_invite it. ${message}`,
    };
  }
  if (
    status === 402 ||
    code === 'INSUFFICIENT_GAS' ||
    /insufficient ?gas|insufficientcoinbalance|no valid gas coins|gasbalancetoolow/i.test(message)
  ) {
    const fund =
      ctx.network === 'testnet'
        ? `Fund it at ${webFaucetUrl(ctx.address)} or call system_setup.`
        : 'Send SUI to it to pay for gas.';
    return {
      code: 'INSUFFICIENT_GAS',
      message: `Wallet ${ctx.address} has too little SUI for gas. ${fund}`,
      details: { address: ctx.address, cause: message },
    };
  }
  return null;
}
