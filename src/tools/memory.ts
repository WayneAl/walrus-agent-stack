/**
 * Strategy A — Send-as-message-with-attachment.
 *
 * The plan's `client.messaging.uploadAttachment` / `downloadAttachment` methods
 * do NOT exist on the v0.0.2 SDK. The real surface is:
 *   - `sendMessage({ signer, groupRef, text?, files? }) -> { messageId }`
 *     with `files: AttachmentFile[]` where each file is `{ fileName, mimeType, data: Uint8Array }`.
 *   - `getMessage({ signer, groupRef, messageId }) -> DecryptedMessage`
 *     where `DecryptedMessage.attachments: AttachmentHandle[]` and each handle
 *     exposes `data(): Promise<Uint8Array>` (lazy download + decrypt).
 *
 * We piggy-back on this: each `memory_write` posts a files-only message whose
 * single attachment carries the encoded blob JSON. The relayer's per-group Seal
 * envelope handles encryption — we never touch the Walrus adapter directly,
 * and decryption requires group membership just like any other message.
 *
 * URI shape: `walrus://<messageId>?channel=<channel_id>&key=<key>`.
 * `<messageId>` is what `getMessage` requires to fetch; `?channel=` is the
 * group hint without which we cannot decrypt; `?key=` is informational and
 * mirrors the attachment's `fileName`.
 *
 * Trade-off: the SDK's `messageId` is not a Walrus blob id. That's fine —
 * the URI is opaque to callers; the only contract is round-trip through these
 * two tools. The Walrus blob lives one layer deeper (per-attachment storageId)
 * and is reachable via `attachments[0].wire.storageId` if a future tool needs
 * the underlying blob id.
 */
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolDef } from '../mcp/dispatch.js';
import { MemoryWriteArgs, MemoryReadArgs } from '../schemas.js';
import type { SdkContext } from '../sdk-client.js';
import {
  encodeBlob,
  decodeBlob,
  verifyBlob,
  type MemoryBlobInput,
} from '../memory-blob.js';
import { buildWalrusUri, parseWalrusUri } from '../walrus-uri.js';
import { resolveChannelId } from '../session.js';

const MEMORY_MIME = 'application/x-walrus-agent-stack-memory+json';

export function writeTool(sdk: SdkContext): ToolDef<z.infer<typeof MemoryWriteArgs>> {
  return {
    name: 'memory_write',
    description:
      'Store a signed, encrypted document (report, code, data) on Walrus, readable only by members of the channel (default: the active channel). ' +
      'Returns a walrus:// URI; pass it in channel_send `refs` so other agents can memory_read it. Use for content too large for a chat message.',
    schema: MemoryWriteArgs,
    handler: async (args) => {
      const { key, content, content_type, agent_id } = args;
      const channel_id = resolveChannelId(sdk.config.home, args.channel_id);
      const message_id = randomUUID();
      const input: MemoryBlobInput = {
        channel_id,
        key,
        content_type,
        content,
        author_agent_id: agent_id,
        message_id,
      };
      const blobJson = await encodeBlob(input, sdk.keypair);

      const { messageId } = await sdk.client.messaging.sendMessage({
        signer: sdk.keypair,
        groupRef: { uuid: channel_id },
        files: [
          {
            fileName: key,
            mimeType: MEMORY_MIME,
            data: new TextEncoder().encode(blobJson),
            extras: { content_type, author_message_id: message_id },
          },
        ],
      });

      const uri = buildWalrusUri(messageId, channel_id, key);
      return {
        uri,
        blob_id: messageId,
        channel_id,
        key,
        message_id,
        author: sdk.keypair.toSuiAddress(),
      };
    },
  };
}

export function readTool(sdk: SdkContext): ToolDef<z.infer<typeof MemoryReadArgs>> {
  return {
    name: 'memory_read',
    description:
      'Read a walrus:// URI produced by memory_write (e.g. from a message\'s refs): decrypts it, verifies the author\'s signature and returns the content. `warning: MEMORY_TAMPERED` means the signature did not verify.',
    schema: MemoryReadArgs,
    handler: async ({ uri }) => {
      const parsed = parseWalrusUri(uri);
      if (!parsed.channel) {
        throw {
          code: 'MISSING_CHANNEL_HINT',
          message: 'walrus URI must carry ?channel= hint for Seal decrypt',
        };
      }

      const msg = await sdk.client.messaging.getMessage({
        signer: sdk.keypair,
        groupRef: { uuid: parsed.channel },
        messageId: parsed.blobId,
      });

      const handle = msg.attachments[0];
      if (!handle) {
        throw {
          code: 'MEMORY_NOT_FOUND',
          message: `message ${parsed.blobId} has no attachments`,
        };
      }
      const bytes = await handle.data();
      const text = new TextDecoder().decode(bytes);
      const blob = decodeBlob(text);
      const verified = await verifyBlob(blob);

      return {
        uri,
        verified,
        content: blob.content,
        content_type: blob.content_type,
        author: blob.metadata.author,
        author_agent_id: blob.metadata.author_agent_id,
        message_id: blob.metadata.message_id,
        created_at_ms: blob.metadata.created_at_ms,
        ...(verified ? {} : { warning: 'MEMORY_TAMPERED' as const }),
      };
    },
  };
}
