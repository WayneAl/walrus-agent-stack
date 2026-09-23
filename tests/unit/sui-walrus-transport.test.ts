import { describe, it, expect, beforeEach } from 'vitest';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { SimulationError, type SuiClientTypes } from '@mysten/sui/client';
import { bcs } from '@mysten/sui/bcs';
import type { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import { deriveDynamicFieldID, fromBase64, toHex } from '@mysten/sui/utils';
import {
  buildCanonicalMessage,
  RelayerTransportError,
  verifyMessageSender,
  type Attachment,
  type RelayerMessage,
} from '@mysten/sui-stack-messaging';
import { SuiWalrusTransport, channelLogAddress } from '../../src/transport/sui-walrus-transport.js';

const PKG = '0x' + 'a1'.repeat(32);
const REGISTRY = '0x' + 'b2'.repeat(32);
const GROUP = '0x' + 'c3'.repeat(32);
const OTHER_GROUP = '0x' + 'd4'.repeat(32);
const PUBLISHER = 'https://publisher.test';
const AGGREGATOR = 'https://aggregator.test';

// On-chain struct layouts, re-declared independently of the implementation.
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
const FieldBcs = bcs.struct('Field', {
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

interface FakeEntry {
  blobId: string;
  sender: string;
  timestampMs: number;
}

/** In-memory Walrus publisher + aggregator behind a `fetch` stub. */
class FakeWalrus {
  blobs = new Map<string, Uint8Array>();
  uploads = 0;
  failUploads = false;
  #next = 0;

  put(data: Uint8Array): string {
    const id = `blob-${this.#next++}`;
    this.blobs.set(id, data);
    return id;
  }

  putJson(value: unknown): string {
    return this.put(new TextEncoder().encode(JSON.stringify(value)));
  }

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(`${PUBLISHER}/v1/blobs?epochs=`) && init?.method === 'PUT') {
      if (this.failUploads) return new Response('boom', { status: 500 });
      this.uploads++;
      const blobId = this.put(new Uint8Array(init.body as Uint8Array));
      return Response.json({
        newlyCreated: { blobObject: { id: '0x1', blobId } },
      });
    }
    const prefix = `${AGGREGATOR}/v1/blobs/`;
    if (url.startsWith(prefix)) {
      const blob = this.blobs.get(url.slice(prefix.length));
      return blob ? new Response(blob) : new Response('not found', { status: 404 });
    }
    return new Response('unexpected url', { status: 400 });
  };
}

/** Minimal `grpc.core` over an in-memory `channel_log` state. */
class FakeChain {
  logs = new Map<string, { entries: FakeEntry[] }>();
  senders = new Set<string>();
  executed: Transaction[] = [];
  /** Hook run just before executing a tx (e.g. to simulate a racing creator). */
  beforeExecute?: () => void;
  /** When set, `signAndExecuteTransaction` throws this instead (build-time dry-run failure). */
  throwOnExecute?: Error;
  clock = 1_700_000_000_000;

  tableId(groupId: string): string {
    return deriveDynamicFieldID(channelLogAddress(REGISTRY, groupId), 'u64', new Uint8Array([7]));
  }

  push(groupId: string, entry: FakeEntry): number {
    let log = this.logs.get(groupId);
    if (!log) this.logs.set(groupId, (log = { entries: [] }));
    log.entries.push(entry);
    return log.entries.length - 1;
  }

  #objects(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const [groupId, log] of this.logs) {
      const logId = channelLogAddress(REGISTRY, groupId);
      const tableId = this.tableId(groupId);
      out.set(
        logId,
        ChannelLogBcs.serialize({
          id: logId,
          group_id: groupId,
          entries: {
            contents: { id: tableId, size: BigInt(log.entries.length) },
          },
        }).toBytes(),
      );
      log.entries.forEach((e, i) => {
        const fieldId = deriveDynamicFieldID(tableId, 'u64', bcs.u64().serialize(i).toBytes());
        out.set(
          fieldId,
          FieldBcs.serialize({
            id: fieldId,
            name: BigInt(i),
            value: {
              blob_id: e.blobId,
              sender: e.sender,
              timestamp_ms: BigInt(e.timestampMs),
            },
          }).toBytes(),
        );
      });
    }
    return out;
  }

  #abort(module: string, code: string): SuiClientTypes.TransactionResult<{ events: true }> {
    const error = {
      $kind: 'MoveAbort',
      message: `MoveAbort in ${module}: ${code}`,
      MoveAbort: { abortCode: code, location: { module } },
    } as SuiClientTypes.ExecutionError;
    return {
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: 'failed',
        signatures: [],
        epoch: null,
        status: { success: false, error },
        events: [],
      } as unknown as SuiClientTypes.Transaction<{ events: true }>,
    };
  }

  core = {
    getObjects: async ({ objectIds }: { objectIds: string[] }) => {
      const objects = this.#objects();
      return {
        objects: objectIds.map((id) => {
          const content = objects.get(id);
          return content ? { objectId: id, content } : new Error(`Object ${id} not found`);
        }),
      };
    },
    signAndExecuteTransaction: async ({
      transaction,
      signer,
    }: {
      transaction: Transaction;
      signer: Ed25519Keypair;
    }) => {
      this.executed.push(transaction);
      if (this.throwOnExecute) throw this.throwOnExecute;
      this.beforeExecute?.();
      const data = transaction.getData();
      const calls = data.commands.map((c) => c.MoveCall!);
      const post = calls.find((c) => c.function === 'post')!;
      const inputAt = (i: number) => {
        const arg = post.arguments[i]!;
        return arg.$kind === 'Input' ? data.inputs[arg.Input]! : undefined;
      };
      const groupId = inputAt(1)!.UnresolvedObject!.objectId;
      const blobId = bcs.string().parse(fromBase64(inputAt(2)!.Pure!.bytes));
      const sender = signer.toSuiAddress();

      if (!this.senders.has(sender)) return this.#abort('channel_log', '0');
      if (calls[0]!.function === 'new_log' && this.logs.has(groupId)) {
        return this.#abort('derived_object', '0');
      }
      if (calls[0]!.function !== 'new_log' && !this.logs.has(groupId)) {
        throw new Error('post on a missing log');
      }
      const order = this.push(groupId, {
        blobId,
        sender,
        timestampMs: this.clock++,
      });
      return {
        $kind: 'Transaction',
        Transaction: {
          digest: `tx-${order}`,
          status: { success: true, error: null },
          events: [
            {
              eventType: `${PKG}::channel_log::Posted`,
              bcs: PostedBcs.serialize({
                group_id: groupId,
                log_id: channelLogAddress(REGISTRY, groupId),
                order: BigInt(order),
                sender,
                blob_id: blobId,
              }).toBytes(),
            },
          ],
        },
      };
    },
    waitForTransaction: async () => ({}),
  };
}

function functionsOf(tx: Transaction): string[] {
  return tx.getData().commands.map((c) => c.MoveCall!.function);
}

async function signCanonical(
  kp: Ed25519Keypair,
  p: {
    groupId: string;
    encryptedText: Uint8Array;
    nonce: Uint8Array;
    keyVersion: bigint;
  },
): Promise<string> {
  const { signature } = await kp.signPersonalMessage(buildCanonicalMessage(p));
  return toHex(parseSerializedSignature(signature).signature!);
}

describe('SuiWalrusTransport', () => {
  let chain: FakeChain;
  let walrus: FakeWalrus;
  let transport: SuiWalrusTransport;
  let alice: Ed25519Keypair;

  beforeEach(() => {
    chain = new FakeChain();
    walrus = new FakeWalrus();
    alice = Ed25519Keypair.generate();
    chain.senders.add(alice.toSuiAddress());
    transport = new SuiWalrusTransport({
      grpc: chain as unknown as SuiGrpcClient,
      packageId: PKG,
      registryId: REGISTRY,
      walrus: {
        publisherUrl: PUBLISHER,
        aggregatorUrl: AGGREGATOR,
        epochs: 30,
      },
      pollIntervalMs: 5,
      fetchImpl: walrus.fetch,
    });
  });

  async function send(text: string, signer = alice) {
    return transport.sendMessage({
      signer,
      groupId: GROUP,
      encryptedText: new TextEncoder().encode(text),
      nonce: new Uint8Array(12).fill(1),
      keyVersion: 0n,
    });
  }

  /** Envelope as the transport writes it, for entries planted directly on the fake chain. */
  function envelope(overrides: Record<string, unknown> = {}) {
    return {
      v: 1,
      groupId: GROUP,
      senderAddress: alice.toSuiAddress(),
      encryptedText: 'AQID',
      nonce: 'BAUG',
      keyVersion: '0',
      attachments: [],
      signature: '',
      publicKey: '',
      createdAt: 0,
      ...overrides,
    };
  }

  it('round-trips the SDK payload byte-exactly, including a verifiable signature', async () => {
    const encryptedText = crypto.getRandomValues(new Uint8Array(77));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const keyVersion = 3n;
    const attachments: Attachment[] = [
      {
        storageId: 'patch-1',
        nonce: 'aa'.repeat(12),
        encryptedMetadata: 'beef',
        metadataNonce: 'bb'.repeat(12),
      },
    ];
    const messageSignature = await signCanonical(alice, {
      groupId: GROUP,
      encryptedText,
      nonce,
      keyVersion,
    });

    const { messageId } = await transport.sendMessage({
      signer: alice,
      groupId: GROUP,
      encryptedText,
      nonce,
      keyVersion,
      attachments,
      messageSignature,
    });
    expect(messageId).toBe('0');

    const { messages, hasNext } = await transport.fetchMessages({
      signer: alice,
      groupId: GROUP,
    });
    expect(hasNext).toBe(false);
    expect(messages).toHaveLength(1);
    const m = messages[0]!;
    expect(m.messageId).toBe('0');
    expect(m.order).toBe(0);
    expect(m.groupId).toBe(GROUP);
    expect(m.encryptedText).toEqual(encryptedText);
    expect(m.nonce).toEqual(nonce);
    expect(m.keyVersion).toBe(3n);
    expect(m.attachments).toEqual(attachments);
    expect(m.senderAddress).toBe(alice.toSuiAddress());
    expect(m.signature).toBe(messageSignature);
    expect(m.publicKey).toBe(toHex(alice.getPublicKey().toSuiBytes()));
    expect(m.createdAt).toBe(chain.logs.get(GROUP)!.entries[0]!.timestampMs);
    expect(m.updatedAt).toBe(m.createdAt);
    expect(m.isEdited).toBe(false);
    expect(m.isDeleted).toBe(false);
    expect(await verifyMessageSender(m)).toBe(true);
  });

  it('first post creates the log in one PTB (new_log + post + share_log); later posts only post', async () => {
    expect((await send('one')).messageId).toBe('0');
    expect((await send('two')).messageId).toBe('1');
    expect(chain.executed).toHaveLength(2);
    expect(functionsOf(chain.executed[0]!)).toEqual(['new_log', 'post', 'share_log']);
    expect(functionsOf(chain.executed[1]!)).toEqual(['post']);
    // Post-only PTB targets the derived log object directly.
    const inputs = chain.executed[1]!.getData().inputs;
    expect(inputs[0]!.UnresolvedObject?.objectId).toBe(channelLogAddress(REGISTRY, GROUP));
    expect(walrus.uploads).toBe(2);
  });

  it('retries once with a plain post when another member created the log first', async () => {
    const bob = Ed25519Keypair.generate();
    chain.senders.add(bob.toSuiAddress());
    chain.beforeExecute = () => {
      chain.beforeExecute = undefined;
      chain.push(GROUP, {
        blobId: walrus.putJson(envelope({ senderAddress: bob.toSuiAddress() })),
        sender: bob.toSuiAddress(),
        timestampMs: 1,
      });
    };
    expect((await send('racing')).messageId).toBe('1');
    expect(chain.executed.map(functionsOf)).toEqual([['new_log', 'post', 'share_log'], ['post']]);
  });

  it('maps a channel_log ENotSender abort to 403 NOT_GROUP_MEMBER', async () => {
    const mallory = Ed25519Keypair.generate();
    const err = await send('hi', mallory).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayerTransportError);
    expect((err as RelayerTransportError).status).toBe(403);
    expect((err as RelayerTransportError).code).toBe('NOT_GROUP_MEMBER');
  });

  it('maps an abort surfaced by the build-time dry run the same way', async () => {
    chain.throwOnExecute = new SimulationError('Transaction resolution failed', {
      executionError: {
        $kind: 'MoveAbort',
        message: 'abort',
        MoveAbort: { abortCode: '0', location: { module: 'channel_log' } },
      } as SuiClientTypes.ExecutionError,
    });
    const err = (await send('hi').catch((e: unknown) => e)) as RelayerTransportError;
    expect(err.status).toBe(403);
    expect(err.code).toBe('NOT_GROUP_MEMBER');
  });

  it('maps gas failures to 402 INSUFFICIENT_GAS', async () => {
    chain.throwOnExecute = new Error('No valid gas coins found for the transaction.');
    const err = (await send('hi').catch((e: unknown) => e)) as RelayerTransportError;
    expect(err.status).toBe(402);
    expect(err.code).toBe('INSUFFICIENT_GAS');
  });

  it('maps a Walrus upload failure to WALRUS_UNAVAILABLE without touching the chain', async () => {
    walrus.failUploads = true;
    const err = (await send('hi').catch((e: unknown) => e)) as RelayerTransportError;
    expect(err.code).toBe('WALRUS_UNAVAILABLE');
    expect(chain.executed).toHaveLength(0);
  });

  it('drops entries whose envelope disagrees with the chain (sender or group)', async () => {
    const bob = Ed25519Keypair.generate();
    await send('genuine'); // order 0
    // order 1: bob posted on chain, but the envelope claims alice sent it.
    chain.push(GROUP, {
      blobId: walrus.putJson(envelope()),
      sender: bob.toSuiAddress(),
      timestampMs: 2,
    });
    // order 2: replay of an envelope from another group.
    chain.push(GROUP, {
      blobId: walrus.putJson(envelope({ groupId: OTHER_GROUP })),
      sender: alice.toSuiAddress(),
      timestampMs: 3,
    });
    // order 3: blob expired / missing on Walrus.
    chain.push(GROUP, {
      blobId: 'gone',
      sender: alice.toSuiAddress(),
      timestampMs: 4,
    });
    // order 4: valid.
    chain.push(GROUP, {
      blobId: walrus.putJson(envelope({ senderAddress: bob.toSuiAddress() })),
      sender: bob.toSuiAddress(),
      timestampMs: 5,
    });

    const { messages } = await transport.fetchMessages({
      signer: alice,
      groupId: GROUP,
    });
    expect(messages.map((m) => m.order)).toEqual([0, 4]);
    await expect(
      transport.fetchMessage({ signer: alice, groupId: GROUP, messageId: '1' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  describe('windowing', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        chain.push(GROUP, {
          blobId: walrus.putJson(envelope()),
          sender: alice.toSuiAddress(),
          timestampMs: i,
        });
      }
    });

    const orders = (r: { messages: RelayerMessage[] }) => r.messages.map((m) => m.order);
    const fetchWin = (p: { afterOrder?: number; beforeOrder?: number; limit?: number }) =>
      transport.fetchMessages({ signer: alice, groupId: GROUP, ...p });

    it('returns everything ascending by default', async () => {
      const r = await fetchWin({});
      expect(orders(r)).toEqual([0, 1, 2, 3, 4]);
      expect(r.hasNext).toBe(false);
    });

    it('afterOrder is exclusive and limit sets hasNext', async () => {
      const r = await fetchWin({ afterOrder: 1, limit: 2 });
      expect(orders(r)).toEqual([2, 3]);
      expect(r.hasNext).toBe(true);
      const tail = await fetchWin({ afterOrder: 3, limit: 2 });
      expect(orders(tail)).toEqual([4]);
      expect(tail.hasNext).toBe(false);
    });

    it('beforeOrder is an exclusive upper bound', async () => {
      expect(orders(await fetchWin({ beforeOrder: 3 }))).toEqual([0, 1, 2]);
      const r = await fetchWin({ afterOrder: 0, beforeOrder: 4, limit: 2 });
      expect(orders(r)).toEqual([1, 2]);
      expect(r.hasNext).toBe(true);
      const exact = await fetchWin({ afterOrder: 0, beforeOrder: 3, limit: 2 });
      expect(orders(exact)).toEqual([1, 2]);
      expect(exact.hasNext).toBe(false);
    });

    it('past the end, or on a group with no log, is empty', async () => {
      expect(await fetchWin({ afterOrder: 4 })).toEqual({
        messages: [],
        hasNext: false,
      });
      expect(await transport.fetchMessages({ signer: alice, groupId: OTHER_GROUP })).toEqual({
        messages: [],
        hasNext: false,
      });
    });

    it('fetchMessage reads one entry by its decimal id', async () => {
      const m = await transport.fetchMessage({
        signer: alice,
        groupId: GROUP,
        messageId: '3',
      });
      expect(m.order).toBe(3);
      expect(m.createdAt).toBe(3);
      await expect(
        transport.fetchMessage({
          signer: alice,
          groupId: GROUP,
          messageId: '5',
        }),
      ).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  it('subscribe yields existing then newly posted entries, skipping dropped ones, until aborted', async () => {
    await send('a'); // 0
    chain.push(GROUP, {
      blobId: 'gone',
      sender: alice.toSuiAddress(),
      timestampMs: 9,
    }); // 1, dropped
    const ac = new AbortController();
    const seen: number[] = [];
    const done = (async () => {
      for await (const m of transport.subscribe({
        signer: alice,
        groupId: GROUP,
        signal: ac.signal,
      })) {
        seen.push(m.order);
        if (seen.length === 1) await send('b'); // 2
        if (seen.length === 2) ac.abort();
      }
    })();
    await done;
    expect(seen).toEqual([0, 2]);
  });

  it('rejects edit and delete with 405', async () => {
    const base = { signer: alice, groupId: GROUP, messageId: '0' };
    await expect(
      transport.updateMessage({
        ...base,
        encryptedText: new Uint8Array(),
        nonce: new Uint8Array(),
        keyVersion: 0n,
      }),
    ).rejects.toMatchObject({ status: 405 });
    await expect(transport.deleteMessage(base)).rejects.toMatchObject({
      status: 405,
    });
  });
});
