import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import {
  deriveDynamicFieldID,
  deriveObjectID,
  fromBase64,
  normalizeSuiAddress,
  toBase64,
  toHex,
} from '@mysten/sui/utils';
import { RelayerTransportError } from '@mysten/sui-stack-messaging';
import type {
  Attachment,
  DeleteMessageParams,
  FetchMessageParams,
  FetchMessagesParams,
  FetchMessagesResult,
  RelayerMessage,
  RelayerTransport,
  SendMessageParams,
  SendMessageResult,
  SubscribeParams,
  UpdateMessageParams,
} from '@mysten/sui-stack-messaging';

/**
 * Serverless `RelayerTransport`: messages live as JSON envelope blobs on
 * Walrus, and their order + authorization live in a per-group on-chain
 * `channel_log::ChannelLog` (see `move/channel_log`). Seal encryption and the
 * per-message signature are produced by the SDK before `sendMessage` is called
 * and verified by the SDK after `fetchMessages` returns — this transport only
 * has to round-trip those bytes exactly.
 *
 * `order` is the entry's index in the log's `TableVec` (dense from 0), and
 * `messageId` is its decimal string.
 */
export interface SuiWalrusTransportOptions {
  grpc: SuiGrpcClient; // @mysten/sui/grpc — no JSON-RPC client
  packageId: string;
  registryId: string;
  walrus: { publisherUrl: string; aggregatorUrl: string; epochs: number };
  pollIntervalMs?: number; // subscribe polling, default 3000
  fetchImpl?: typeof fetch; // test seam
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
// Mirrors the relayer's `DEFAULT_PAGE_LIMIT` / `MAX_PAGE_LIMIT`.
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const WALRUS_TIMEOUT_MS = 30_000;

// channel_log abort codes (move/channel_log/sources/channel_log.move).
const E_NOT_SENDER = '0';
const E_WRONG_GROUP = '1';
const E_EMPTY_BLOB_ID = '2';

/** JSON envelope stored as one Walrus blob per message. */
interface Envelope {
  v: 1;
  groupId: string;
  senderAddress: string;
  encryptedText: string; // base64
  nonce: string; // base64
  keyVersion: string; // bigint as decimal
  attachments: Attachment[];
  signature: string; // hex, raw 64-byte per-message signature
  publicKey: string; // hex, flag-prefixed Sui public key
  createdAt: number;
}

interface LogEntry {
  order: number;
  blobId: string;
  sender: string;
  timestampMs: number;
}

interface LogHeader {
  logId: string;
  tableId: string;
  length: number;
}

// BCS layouts of the on-chain structs we read. UIDs / IDs serialize as a bare
// 32-byte address; `TableVec<T>` is `{ contents: Table<u64, T> }` and
// `Table` is `{ id: UID, size: u64 }`.
const ChannelLogBcs = bcs.struct('ChannelLog', {
  id: bcs.Address,
  group_id: bcs.Address,
  entries: bcs.struct('TableVec', {
    contents: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
  }),
});
const EntryBcs = bcs.struct('Entry', {
  blob_id: bcs.string(),
  sender: bcs.Address,
  timestamp_ms: bcs.u64(),
});
// `dynamic_field::Field<u64, Entry>` — how the TableVec stores element `i`.
const EntryFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.u64(),
  value: EntryBcs,
});
const PostedBcs = bcs.struct('Posted', {
  group_id: bcs.Address,
  log_id: bcs.Address,
  order: bcs.u64(),
  sender: bcs.Address,
  blob_id: bcs.string(),
});

/**
 * Address of the group's `ChannelLog`: `derived_object::claim(&mut registry.id, group_id)`
 * derives it from the registry with key type `0x2::object::ID`.
 */
export function channelLogAddress(registryId: string, groupId: string): string {
  return deriveObjectID(registryId, '0x2::object::ID', bcs.Address.serialize(groupId).toBytes());
}

function sameAddress(a: string, b: string): boolean {
  return normalizeSuiAddress(a) === normalizeSuiAddress(b);
}

function isNotFound(e: unknown): boolean {
  // gRPC BatchGetObjects reports a missing object as a per-object Error whose
  // message carries no structured code; match the text.
  return e instanceof Error && /not[\s_-]?found|does not exist/i.test(e.message);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Map a failed transaction (either a `FailedTransaction` result or the
 * `SimulationError` thrown while building — gas estimation dry-runs the tx, so
 * most Move aborts surface there) to a `RelayerTransportError`.
 */
function toTxError(e: unknown): RelayerTransportError {
  if (e instanceof RelayerTransportError) return e;
  const execError = (e as { executionError?: SuiClientTypes.ExecutionError } | null)
    ?.executionError;
  const message = e instanceof Error ? e.message : String(e);
  return execErrorToTransportError(execError, message);
}

function execErrorToTransportError(
  err: SuiClientTypes.ExecutionError | undefined,
  fallbackMessage: string,
): RelayerTransportError {
  const message = err?.message ?? fallbackMessage;
  const abort = err?.$kind === 'MoveAbort' ? err.MoveAbort : undefined;
  if (abort && abort.location?.module === 'channel_log') {
    if (abort.abortCode === E_NOT_SENDER) {
      return new RelayerTransportError(
        `Not a sender in this group: ${message}`,
        403,
        'NOT_GROUP_MEMBER',
      );
    }
    if (abort.abortCode === E_WRONG_GROUP) {
      return new RelayerTransportError(
        `Log belongs to another group: ${message}`,
        400,
        'WRONG_GROUP',
      );
    }
    if (abort.abortCode === E_EMPTY_BLOB_ID) {
      return new RelayerTransportError(`Empty blob id: ${message}`, 400, 'EMPTY_BLOB_ID');
    }
  }
  if (
    /insufficient\s*gas|insufficientgas|insufficient\s*(coin\s*)?balance|no valid gas coins|gasbalancetoolow/i.test(
      message,
    )
  ) {
    return new RelayerTransportError(`Insufficient gas: ${message}`, 402, 'INSUFFICIENT_GAS');
  }
  return new RelayerTransportError(`Transaction failed: ${message}`, 500, 'TX_FAILED');
}

export class SuiWalrusTransport implements RelayerTransport {
  readonly #grpc: SuiGrpcClient;
  readonly #packageId: string;
  readonly #registryId: string;
  readonly #publisherUrl: string;
  readonly #aggregatorUrl: string;
  readonly #epochs: number;
  readonly #pollIntervalMs: number;
  readonly #fetch: typeof fetch;
  #disconnected = false;
  readonly #abortController = new AbortController();

  constructor(opts: SuiWalrusTransportOptions) {
    this.#grpc = opts.grpc;
    this.#packageId = opts.packageId;
    this.#registryId = opts.registryId;
    this.#publisherUrl = opts.walrus.publisherUrl.replace(/\/+$/, '');
    this.#aggregatorUrl = opts.walrus.aggregatorUrl.replace(/\/+$/, '');
    this.#epochs = opts.walrus.epochs;
    this.#pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    this.#assertConnected();
    const envelope: Envelope = {
      v: 1,
      groupId: params.groupId,
      senderAddress: params.signer.toSuiAddress(),
      encryptedText: toBase64(params.encryptedText),
      nonce: toBase64(params.nonce),
      keyVersion: params.keyVersion.toString(),
      attachments: params.attachments ?? [],
      signature: params.messageSignature ?? '',
      publicKey: toHex(params.signer.getPublicKey().toSuiBytes()),
      createdAt: Date.now(),
    };
    const blobId = await this.#uploadBlob(new TextEncoder().encode(JSON.stringify(envelope)));

    const logId = channelLogAddress(this.#registryId, params.groupId);
    const header = await this.#readLogHeader(logId);
    let order: number;
    if (header) {
      order = await this.#post(params.signer, params.groupId, blobId, false);
    } else {
      try {
        order = await this.#post(params.signer, params.groupId, blobId, true);
      } catch (e) {
        // Another member created the log between our read and our tx: the
        // `derived_object::claim` in `new_log` aborts. Retry once as a plain post.
        if (!(e instanceof RelayerTransportError) || e.code !== 'TX_FAILED') throw e;
        if (!(await this.#readLogHeader(logId))) throw e;
        order = await this.#post(params.signer, params.groupId, blobId, false);
      }
    }
    return { messageId: String(order) };
  }

  async fetchMessages(params: FetchMessagesParams): Promise<FetchMessagesResult> {
    const { messages, hasNext } = await this.#fetchWindow(params);
    return { messages, hasNext };
  }

  /**
   * `fetchMessages` plus `lastScanned`, the highest order read in the window
   * (including dropped entries) so `subscribe` can advance past them.
   */
  async #fetchWindow(
    params: FetchMessagesParams,
  ): Promise<FetchMessagesResult & { lastScanned?: number }> {
    this.#assertConnected();
    const header = await this.#readLogHeader(channelLogAddress(this.#registryId, params.groupId));
    if (!header) return { messages: [], hasNext: false };

    // Same window as the relayer: order > afterOrder && order < beforeOrder,
    // ascending, truncated to `limit`; hasNext = more remain in the window.
    const limit = Math.min(params.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const lo = Math.max(0, params.afterOrder !== undefined ? params.afterOrder + 1 : 0);
    const hi = Math.min(header.length, params.beforeOrder ?? header.length);
    if (hi <= lo || limit <= 0) return { messages: [], hasNext: false };
    const end = Math.min(hi, lo + limit);
    const orders = Array.from({ length: end - lo }, (_, i) => lo + i);

    const entries = await this.#readEntries(header.tableId, orders);
    const messages = await Promise.all(entries.map((e) => this.#toMessage(e, params.groupId)));
    return {
      messages: messages.filter((m): m is RelayerMessage => m !== null),
      hasNext: end < hi,
      lastScanned: end - 1,
    };
  }

  async fetchMessage(params: FetchMessageParams): Promise<RelayerMessage> {
    this.#assertConnected();
    const order = Number(params.messageId);
    const notFound = new RelayerTransportError(
      `Message ${params.messageId} not found`,
      404,
      'MESSAGE_NOT_FOUND',
    );
    if (!/^\d+$/.test(params.messageId) || !Number.isSafeInteger(order)) throw notFound;
    const header = await this.#readLogHeader(channelLogAddress(this.#registryId, params.groupId));
    if (!header || order >= header.length) throw notFound;
    const [entry] = await this.#readEntries(header.tableId, [order]);
    const message = entry ? await this.#toMessage(entry, params.groupId) : null;
    if (!message) throw notFound;
    return message;
  }

  async updateMessage(_params: UpdateMessageParams): Promise<void> {
    throw new RelayerTransportError('Editing is not supported by the Sui/Walrus transport', 405);
  }

  async deleteMessage(_params: DeleteMessageParams): Promise<void> {
    throw new RelayerTransportError('Deleting is not supported by the Sui/Walrus transport', 405);
  }

  /**
   * Poll the log (each `fetchMessages` reads its length first) and yield new
   * entries. Same loop shape as `HTTPRelayerTransport.subscribe`: 4xx errors
   * end the stream, anything else is retried after one interval.
   */
  async *subscribe(params: SubscribeParams): AsyncIterable<RelayerMessage> {
    let lastOrder = params.afterOrder;
    while (!this.#disconnected && !params.signal?.aborted) {
      try {
        const result = await this.#fetchWindow({
          signer: params.signer,
          groupId: params.groupId,
          afterOrder: lastOrder,
          limit: params.limit,
        });
        for (const message of result.messages) {
          if (this.#disconnected || params.signal?.aborted) return;
          yield message;
          lastOrder = message.order;
        }
        if (result.lastScanned !== undefined) lastOrder = result.lastScanned;
        if (!result.hasNext) await delay(this.#pollIntervalMs, params.signal);
      } catch (error) {
        if (this.#disconnected || params.signal?.aborted) return;
        if (error instanceof RelayerTransportError && error.status >= 400 && error.status < 500) {
          throw error;
        }
        await delay(this.#pollIntervalMs, params.signal);
      }
    }
  }

  disconnect(): void {
    this.#disconnected = true;
    this.#abortController.abort();
  }

  #assertConnected(): void {
    if (this.#disconnected) throw new RelayerTransportError('Transport is disconnected', 0);
  }

  // ---- chain reads -------------------------------------------------------
  // The log is read with plain `core.getObjects` on computed IDs rather than
  // `getDynamicField` / `listDynamicFields`: element `i` of the TableVec is the
  // dynamic field `Field<u64, Entry>` under the inner Table's UID, so its ID is
  // `deriveDynamicFieldID(tableId, 'u64', bcs(i))`, and a whole window is one
  // batched request. (`getDynamicField` would add an MVR type-resolution hop
  // and one request per entry.)

  /** Log header, or `null` if the group has no log yet (nobody has posted). */
  async #readLogHeader(logId: string): Promise<LogHeader | null> {
    const { objects } = await this.#grpc.core.getObjects({
      objectIds: [logId],
      include: { content: true },
    });
    const obj = objects[0];
    if (!obj || obj instanceof Error) {
      if (!obj || isNotFound(obj)) return null;
      throw obj;
    }
    const log = ChannelLogBcs.parse(obj.content);
    return {
      logId,
      tableId: log.entries.contents.id,
      length: Number(log.entries.contents.size),
    };
  }

  /** Entries at `orders` (all must be < length), in the same order. */
  async #readEntries(tableId: string, orders: number[]): Promise<LogEntry[]> {
    if (orders.length === 0) return [];
    const ids = orders.map((o) =>
      deriveDynamicFieldID(tableId, 'u64', bcs.u64().serialize(o).toBytes()),
    );
    const { objects } = await this.#grpc.core.getObjects({
      objectIds: ids,
      include: { content: true },
    });
    return objects.map((obj, i) => {
      if (obj instanceof Error) throw obj;
      const field = EntryFieldBcs.parse(obj.content);
      return {
        order: orders[i]!,
        blobId: field.value.blob_id,
        sender: field.value.sender,
        timestampMs: Number(field.value.timestamp_ms),
      };
    });
  }

  // ---- chain writes ------------------------------------------------------

  /** Append `blobId` to the group's log; returns the new entry's order. */
  async #post(
    signer: Signer,
    groupId: string,
    blobId: string,
    createLog: boolean,
  ): Promise<number> {
    const target = (fn: string) => `${this.#packageId}::channel_log::${fn}` as const;
    const tx = new Transaction();
    const log = createLog
      ? tx.moveCall({
          target: target('new_log'),
          arguments: [tx.object(this.#registryId), tx.object(groupId)],
        })
      : tx.object(channelLogAddress(this.#registryId, groupId));
    tx.moveCall({
      target: target('post'),
      arguments: [log, tx.object(groupId), tx.pure.string(blobId), tx.object.clock()],
    });
    if (createLog) tx.moveCall({ target: target('share_log'), arguments: [log] });

    let result: SuiClientTypes.TransactionResult<{ events: true }>;
    try {
      result = await this.#grpc.core.signAndExecuteTransaction({
        transaction: tx,
        signer,
        include: { events: true },
      });
    } catch (e) {
      throw toTxError(e);
    }
    if (result.$kind === 'FailedTransaction') {
      const status = result.FailedTransaction.status;
      throw execErrorToTransportError(
        status.success ? undefined : status.error,
        'Transaction failed',
      );
    }
    // Make the new entry visible to reads (ours and other members') before returning.
    await this.#grpc.core.waitForTransaction({ result });

    const posted = result.Transaction.events.find((e) =>
      e.eventType.endsWith('::channel_log::Posted'),
    );
    if (!posted) {
      throw new RelayerTransportError('Posted event missing from transaction', 500, 'TX_FAILED');
    }
    return Number(PostedBcs.parse(posted.bcs).order);
  }

  // ---- Walrus ------------------------------------------------------------

  async #uploadBlob(data: Uint8Array): Promise<string> {
    const url = `${this.#publisherUrl}/v1/blobs?epochs=${this.#epochs}`;
    let body: {
      newlyCreated?: { blobObject?: { blobId?: string } };
      alreadyCertified?: { blobId?: string };
    };
    try {
      const res = await this.#fetch(url, {
        method: 'PUT',
        body: data,
        signal: this.#requestSignal(),
      });
      if (!res.ok) {
        throw new Error(`publisher returned ${res.status}: ${await res.text()}`);
      }
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new RelayerTransportError(
        `Walrus upload failed: ${e instanceof Error ? e.message : String(e)}`,
        503,
        'WALRUS_UNAVAILABLE',
      );
    }
    const blobId = body.newlyCreated?.blobObject?.blobId ?? body.alreadyCertified?.blobId;
    if (!blobId) {
      throw new RelayerTransportError(
        'Walrus response has neither newlyCreated nor alreadyCertified',
        502,
        'WALRUS_UNAVAILABLE',
      );
    }
    return blobId;
  }

  /** Blob bytes, or `null` if the aggregator says it does not exist (e.g. expired). */
  async #downloadBlob(blobId: string): Promise<Uint8Array | null> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#aggregatorUrl}/v1/blobs/${blobId}`, {
        signal: this.#requestSignal(),
      });
    } catch (e) {
      throw new RelayerTransportError(
        `Walrus download failed: ${e instanceof Error ? e.message : String(e)}`,
        503,
        'WALRUS_UNAVAILABLE',
      );
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new RelayerTransportError(
        `Walrus download failed: aggregator returned ${res.status}`,
        503,
        'WALRUS_UNAVAILABLE',
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  #requestSignal(): AbortSignal {
    return AbortSignal.any([AbortSignal.timeout(WALRUS_TIMEOUT_MS), this.#abortController.signal]);
  }

  /**
   * Download + validate one entry's envelope. Returns `null` (drop) when the
   * blob is gone, unparseable, or disagrees with the chain — the on-chain
   * `Entry.sender` is authoritative (it held MessagingSender at post time), so
   * an envelope claiming a different sender or group is a forgery or a replay.
   * Transient Walrus failures throw instead, so a poller does not skip past them.
   */
  async #toMessage(entry: LogEntry, groupId: string): Promise<RelayerMessage | null> {
    const bytes = await this.#downloadBlob(entry.blobId);
    if (!bytes) return null;
    let env: Envelope;
    try {
      env = JSON.parse(new TextDecoder().decode(bytes)) as Envelope;
    } catch {
      return null;
    }
    if (env?.v !== 1 || typeof env.senderAddress !== 'string' || typeof env.groupId !== 'string') {
      return null;
    }
    if (!sameAddress(env.senderAddress, entry.sender) || !sameAddress(env.groupId, groupId)) {
      return null;
    }
    try {
      return {
        messageId: String(entry.order),
        groupId: env.groupId,
        order: entry.order,
        encryptedText: fromBase64(env.encryptedText),
        nonce: fromBase64(env.nonce),
        keyVersion: BigInt(env.keyVersion),
        senderAddress: env.senderAddress,
        createdAt: entry.timestampMs,
        updatedAt: entry.timestampMs,
        attachments: Array.isArray(env.attachments) ? env.attachments : [],
        isEdited: false,
        isDeleted: false,
        signature: env.signature ?? '',
        publicKey: env.publicKey ?? '',
      };
    } catch {
      return null;
    }
  }
}
