import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

export interface MemoryBlobInput {
  channel_id: string;
  key: string;
  content_type: string;
  content: string;
  author_agent_id?: string;
  message_id: string;
}

export interface MemoryBlob {
  schema_version: 1;
  channel_id: string;
  key: string;
  content_type: string;
  content: string;
  metadata: {
    author: string;
    author_agent_id?: string;
    created_at_ms: number;
    message_id: string;
    signature: string;
  };
}

type UnsignedBlob = Omit<MemoryBlob, 'metadata'> & {
  metadata: Omit<MemoryBlob['metadata'], 'signature'>;
};

function signablePayload(b: UnsignedBlob): string {
  return JSON.stringify({
    schema_version: b.schema_version,
    channel_id: b.channel_id,
    key: b.key,
    content_type: b.content_type,
    content: b.content,
    metadata: {
      author: b.metadata.author,
      author_agent_id: b.metadata.author_agent_id,
      created_at_ms: b.metadata.created_at_ms,
      message_id: b.metadata.message_id,
    },
  });
}

export async function encodeBlob(input: MemoryBlobInput, keypair: Ed25519Keypair): Promise<string> {
  const created_at_ms = Date.now();
  const author = keypair.toSuiAddress();
  const unsigned: UnsignedBlob = {
    schema_version: 1 as const,
    channel_id: input.channel_id,
    key: input.key,
    content_type: input.content_type,
    content: input.content,
    metadata: {
      author,
      author_agent_id: input.author_agent_id,
      created_at_ms,
      message_id: input.message_id,
    },
  };
  const payload = signablePayload(unsigned);
  const sig = await keypair.signPersonalMessage(new TextEncoder().encode(payload));
  const blob: MemoryBlob = {
    ...unsigned,
    metadata: { ...unsigned.metadata, signature: sig.signature },
  };
  return JSON.stringify(blob);
}

export function decodeBlob(raw: string): MemoryBlob {
  const obj: unknown = JSON.parse(raw);
  if (
    typeof obj !== 'object' ||
    obj === null ||
    (obj as { schema_version?: unknown }).schema_version !== 1
  ) {
    const version =
      typeof obj === 'object' && obj !== null
        ? (obj as { schema_version?: unknown }).schema_version
        : undefined;
    throw new Error(`Unsupported schema_version: ${String(version)}`);
  }
  return obj as MemoryBlob;
}

export async function verifyBlob(blob: MemoryBlob): Promise<boolean> {
  const { signature, ...metaWithoutSig } = blob.metadata;
  const payload = signablePayload({ ...blob, metadata: metaWithoutSig });
  try {
    await verifyPersonalMessageSignature(new TextEncoder().encode(payload), signature, {
      address: blob.metadata.author,
    });
    return true;
  } catch {
    return false;
  }
}
