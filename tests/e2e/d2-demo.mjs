#!/usr/bin/env node
// Programmatic D2 demo - spawns two MCP servers (Alice + Bob) over stdio,
// drives them through the plan's 6-step flow, asserts each invariant.
//
// Prereqs:
//   - `.env.alice` and `.env.bob` in repo root with funded SUI_PRIVATE_KEY
//   - A running sui-stack-messaging relayer reachable at RELAYER_URL
//   - `pnpm build` already ran (uses dist/cli.js)
//
// Exits 0 on success, non-zero with an error message on first failure.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnv(role) {
  const path = join(ROOT, `.env.${role}`);
  const text = readFileSync(path, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function connectRole(role) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(ROOT, 'dist/cli.js')],
    env: { ...process.env, ...loadEnv(role) },
  });
  const client = new Client({ name: `e2e-${role}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text;
  if (!text) throw new Error(`No content from ${name}: ${JSON.stringify(result)}`);
  if (result.isError) throw new Error(`Tool ${name} errored: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const alice = await connectRole('alice');
  const bob = await connectRole('bob');
  try {
    console.log('[1/6] Alice creates channel');
    const channel = await call(alice, 'channel.create', { name: 'e2e-test' });
    const cid = channel.channel_id;
    console.log(`  channel_id=${cid}`);

    console.log('[2/6] Alice sends a hello');
    await call(alice, 'channel.send', { channel_id: cid, content: 'hello from alice' });

    console.log('[3/6] Alice writes memory');
    const writeRes = await call(alice, 'memory.write', { channel_id: cid, key: 'a.md', content: 'alice findings' });
    const uri = writeRes.uri;

    console.log('[4/6] Alice invites Bob');
    const bobWho = await call(bob, 'identity.whoami', {});
    const bobAddr = bobWho.address;
    await call(alice, 'channel.invite', { channel_id: cid, address: bobAddr });

    console.log('[5/6] Bob joins, reads history, reads memory');
    await call(bob, 'channel.join', { channel_id: cid });
    const hist = await call(bob, 'channel.history', { channel_id: cid });
    const aliceHello = hist.messages.find((m) => m.body?.text === 'hello from alice');
    if (!aliceHello) throw new Error("Bob did not see Alice's message");
    console.log('  - Bob sees alice message');

    const readRes = await call(bob, 'memory.read', { uri });
    if (readRes.verified !== true) throw new Error('memory.read verified=false');
    console.log('  - Bob reads alice memory with verified=true');

    console.log('[6/6] Bob sends back, Alice verifies');
    const bobMsg = await call(bob, 'channel.send', { channel_id: cid, content: 'bob here' });
    const verifyRes = await call(alice, 'identity.verify', { channel_id: cid, message_id: bobMsg.message_id });
    if (verifyRes.verified !== true) throw new Error('Alice failed to verify Bob');
    if (verifyRes.sender !== bobAddr) throw new Error(`sender mismatch: ${verifyRes.sender} !== ${bobAddr}`);
    console.log('  - Alice verifies Bob signature');

    console.log('\nALL GREEN - D2 demo flow works.');
  } finally {
    await alice.close();
    await bob.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
