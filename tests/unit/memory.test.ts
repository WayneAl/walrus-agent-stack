import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { writeTool, readTool } from '../../src/tools/memory.js';
import { encodeBlob, decodeBlob } from '../../src/memory-blob.js';
import { parseWalrusUri, buildWalrusUri } from '../../src/walrus-uri.js';
import type { SdkContext } from '../../src/sdk-client.js';

interface MockMessaging {
  sendMessage: ReturnType<typeof vi.fn>;
  getMessage: ReturnType<typeof vi.fn>;
}

function makeMockSdk(): {
  sdk: SdkContext;
  messaging: MockMessaging;
  keypair: Ed25519Keypair;
  address: string;
} {
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const messaging: MockMessaging = {
    sendMessage: vi.fn(async () => ({ messageId: 'msg-id-mem-1' })),
    getMessage: vi.fn(async () => ({
      messageId: 'msg-id-mem-1',
      groupId: 'g',
      order: 1,
      text: '',
      senderAddress: address,
      createdAt: 0,
      updatedAt: 0,
      isEdited: false,
      isDeleted: false,
      attachments: [],
      senderVerified: true,
    })),
  };
  const sdk = {
    keypair,
    config: { network: 'testnet' },
    client: { messaging },
  } as unknown as SdkContext;
  return { sdk, messaging, keypair, address };
}

describe('memory tools', () => {
  it('both tools expose correct names and non-empty descriptions', () => {
    const { sdk } = makeMockSdk();
    const tools = [writeTool(sdk), readTool(sdk)];
    expect(tools.map((t) => t.name)).toEqual(['memory_write', 'memory_read']);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  describe('memory_write', () => {
    let env: ReturnType<typeof makeMockSdk>;
    beforeEach(() => {
      env = makeMockSdk();
    });

    it('encodes a signed blob and forwards it to sendMessage as a single file', async () => {
      const tool = writeTool(env.sdk);
      const res = (await tool.handler({
        channel_id: 'chan-1',
        key: 'note.md',
        content: 'hello memory',
        content_type: 'text/markdown',
        agent_id: 'analyst-7',
      })) as {
        uri: string;
        blob_id: string;
        channel_id: string;
        key: string;
        message_id: string;
        author: string;
      };

      expect(env.messaging.sendMessage).toHaveBeenCalledTimes(1);
      const call = env.messaging.sendMessage.mock.calls[0]![0];
      expect(call.signer).toBe(env.keypair);
      expect(call.groupRef).toEqual({ uuid: 'chan-1' });
      expect(call.text).toBeUndefined();
      expect(Array.isArray(call.files)).toBe(true);
      expect(call.files).toHaveLength(1);
      const file = call.files[0];
      expect(file.fileName).toBe('note.md');
      expect(file.mimeType).toBe('application/x-walrus-agent-stack-memory+json');
      expect(file.data).toBeInstanceOf(Uint8Array);

      // Decode the bytes we handed the SDK and make sure they are a valid blob
      // we just signed.
      const payload = new TextDecoder().decode(file.data);
      const blob = decodeBlob(payload);
      expect(blob.channel_id).toBe('chan-1');
      expect(blob.key).toBe('note.md');
      expect(blob.content).toBe('hello memory');
      expect(blob.content_type).toBe('text/markdown');
      expect(blob.metadata.author).toBe(env.address);
      expect(blob.metadata.author_agent_id).toBe('analyst-7');
      // The message_id in the blob matches the one returned by the tool.
      expect(blob.metadata.message_id).toBe(res.message_id);

      // URI shape: walrus://<messageId>?channel=<id>&key=<key>
      expect(res.uri).toBe(buildWalrusUri('msg-id-mem-1', 'chan-1', 'note.md'));
      const parsed = parseWalrusUri(res.uri);
      expect(parsed.blobId).toBe('msg-id-mem-1');
      expect(parsed.channel).toBe('chan-1');
      expect(parsed.key).toBe('note.md');

      expect(res.blob_id).toBe('msg-id-mem-1');
      expect(res.channel_id).toBe('chan-1');
      expect(res.key).toBe('note.md');
      expect(res.author).toBe(env.address);
    });
  });

  describe('memory_read', () => {
    it('parses URI, calls getMessage, decodes a real blob, returns verified payload', async () => {
      const env = makeMockSdk();
      // Build a real signed blob with the same keypair the SDK would use.
      const blobJson = await encodeBlob(
        {
          channel_id: 'chan-2',
          key: 'foo.txt',
          content_type: 'text/plain',
          content: 'persisted content',
          author_agent_id: 'agent-A',
          message_id: 'mem-msg-1',
        },
        env.keypair,
      );
      env.messaging.getMessage.mockResolvedValueOnce({
        messageId: 'msg-id-mem-2',
        groupId: 'g',
        order: 1,
        text: '',
        senderAddress: env.address,
        createdAt: 0,
        updatedAt: 0,
        isEdited: false,
        isDeleted: false,
        senderVerified: true,
        attachments: [
          {
            fileName: 'foo.txt',
            mimeType: 'application/x-walrus-agent-stack-memory+json',
            fileSize: blobJson.length,
            wire: { storageId: 'patch-abc', nonce: '', encryptedMetadata: '', metadataNonce: '' },
            data: vi.fn(async () => new TextEncoder().encode(blobJson)),
          },
        ],
      });

      const uri = buildWalrusUri('msg-id-mem-2', 'chan-2', 'foo.txt');
      const tool = readTool(env.sdk);
      const res = (await tool.handler({ uri })) as {
        uri: string;
        verified: boolean;
        content: string;
        content_type: string;
        author: string;
        author_agent_id?: string;
        message_id: string;
        created_at_ms: number;
        warning?: string;
      };

      expect(env.messaging.getMessage).toHaveBeenCalledTimes(1);
      const call = env.messaging.getMessage.mock.calls[0]![0];
      expect(call.signer).toBe(env.keypair);
      expect(call.groupRef).toEqual({ uuid: 'chan-2' });
      expect(call.messageId).toBe('msg-id-mem-2');

      expect(res.uri).toBe(uri);
      expect(res.verified).toBe(true);
      expect(res.warning).toBeUndefined();
      expect(res.content).toBe('persisted content');
      expect(res.content_type).toBe('text/plain');
      expect(res.author).toBe(env.address);
      expect(res.author_agent_id).toBe('agent-A');
      expect(res.message_id).toBe('mem-msg-1');
      expect(typeof res.created_at_ms).toBe('number');
    });

    it('flags MEMORY_TAMPERED when the blob payload was mutated in transit', async () => {
      const env = makeMockSdk();
      const blobJson = await encodeBlob(
        {
          channel_id: 'chan-3',
          key: 'k',
          content_type: 'text/plain',
          content: 'original content',
          message_id: 'm',
        },
        env.keypair,
      );
      // Mutate the content field of the JSON so the signature no longer matches.
      const parsed = JSON.parse(blobJson) as { content: string };
      parsed.content = 'tampered content';
      const tampered = JSON.stringify(parsed);

      env.messaging.getMessage.mockResolvedValueOnce({
        messageId: 'mid',
        groupId: 'g',
        order: 1,
        text: '',
        senderAddress: env.address,
        createdAt: 0,
        updatedAt: 0,
        isEdited: false,
        isDeleted: false,
        senderVerified: true,
        attachments: [
          {
            fileName: 'k',
            mimeType: 'application/x-walrus-agent-stack-memory+json',
            fileSize: tampered.length,
            wire: { storageId: 's', nonce: '', encryptedMetadata: '', metadataNonce: '' },
            data: async () => new TextEncoder().encode(tampered),
          },
        ],
      });

      const tool = readTool(env.sdk);
      const res = (await tool.handler({
        uri: buildWalrusUri('mid', 'chan-3', 'k'),
      })) as { verified: boolean; warning?: string; content: string };
      expect(res.verified).toBe(false);
      expect(res.warning).toBe('MEMORY_TAMPERED');
      // We still surface the (now-suspect) content so callers can react.
      expect(res.content).toBe('tampered content');
    });

    it('throws MISSING_CHANNEL_HINT when the URI lacks a ?channel= hint', async () => {
      const env = makeMockSdk();
      const tool = readTool(env.sdk);
      await expect(tool.handler({ uri: 'walrus://just-a-blob-id' })).rejects.toMatchObject({
        code: 'MISSING_CHANNEL_HINT',
      });
      expect(env.messaging.getMessage).not.toHaveBeenCalled();
    });
  });
});
