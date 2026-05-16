export interface WalrusUri {
  blobId: string;
  channel?: string;
  key?: string;
}

export function parseWalrusUri(uri: string): WalrusUri {
  if (!uri.startsWith('walrus://')) {
    throw new Error(`Not a walrus URI: ${uri}`);
  }
  const rest = uri.slice('walrus://'.length);
  const [blobId, query] = rest.split('?');
  if (!blobId) throw new Error('Missing blob id');
  const params = new URLSearchParams(query ?? '');
  const channel = params.get('channel') ?? undefined;
  const key = params.get('key') ?? undefined;
  return { blobId, channel, key };
}

export function buildWalrusUri(blobId: string, channel?: string, key?: string): string {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (key) params.set('key', key);
  const q = params.toString();
  return `walrus://${blobId}${q ? `?${q}` : ''}`;
}
