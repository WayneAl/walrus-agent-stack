#!/usr/bin/env node
// Two-machine collaboration over the serverless transport, on testnet.
//
// Each side is its own MCP server process with its own WAS_HOME (key, session,
// log) — the same isolation two computers have. Nothing is shared between them
// except Sui + Walrus.
//
//   node tests/e2e/serverless-two-agents.mjs <host-env-file> <peer-env-file> [server]
//
// Env files hold a funded testnet `SUI_PRIVATE_KEY=suiprivkey1...`. `server`
// defaults to dist/cli.js (use plugin/server/index.mjs to test the bundle).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [hostEnv, peerEnv, server = 'dist/cli.js'] = process.argv.slice(2);
if (!hostEnv || !peerEnv) {
  console.error('usage: serverless-two-agents.mjs <host-env-file> <peer-env-file> [server]');
  process.exit(2);
}

const t0 = Date.now();
const lap = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${s}`);

async function start(label, envFile) {
  const key = readFileSync(envFile, 'utf8').match(/suiprivkey1\w+/)?.[0];
  if (!key) throw new Error(`no SUI_PRIVATE_KEY in ${envFile}`);
  const home = mkdtempSync(join(tmpdir(), `was-${label}-`));
  writeFileSync(join(home, 'config.env'), `SUI_PRIVATE_KEY=${key}\nSUI_NETWORK=testnet\n`, { mode: 0o600 });
  const { SUI_PRIVATE_KEY: _drop, RELAYER_URL: _r, ...env } = process.env;
  const client = new Client({ name: `e2e-${label}`, version: '0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [server], env: { ...env, WAS_HOME: home } }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
    const body = JSON.parse(r.content[0].text);
    if (r.isError) throw new Error(`${label} ${name}: ${JSON.stringify(body)}`);
    return body;
  };
  return { label, client, call };
}

function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  lap(`✓ ${msg}`);
}

const host = await start('host', hostEnv);
const peer = await start('peer', peerEnv);
try {
  const tools = (await host.client.listTools()).tools;
  check(tools.some((t) => t.name === 'channel_wait' && t.inputSchema.properties), 'tools listed with schemas');

  const { address: hostAddr } = await host.call('identity_whoami');
  const { address: peerAddr } = await peer.call('identity_whoami');
  lap(`host ${hostAddr}\n         peer ${peerAddr}`);

  const created = await host.call('channel_create', { name: 'e2e serverless', members: [peerAddr] });
  check(created.invited?.includes(peerAddr), `host created ${created.channel_id} and invited peer`);

  const joined = await peer.call('channel_join', { channel_id: created.channel_id });
  check(joined.joined_as === peerAddr, 'peer joined (channel is now its active channel)');

  const task = await host.call('channel_send', {
    content: 'What is 17 * 23? Put the working in shared memory.',
    intent: 'task',
    to: peerAddr,
    agent_id: 'host-agent',
  });
  lap(`host sent task #${task.message_id}`);

  let got;
  for (let i = 0; i < 6 && !got; i++) {
    const w = await peer.call('channel_wait', { timeout_s: 50 });
    got = w.messages.find((m) => m.intent === 'task');
  }
  check(got && got.verified && got.sender === hostAddr, 'peer received the task, signature verified');

  const mem = await peer.call('memory_write', {
    key: 'peer-agent/answer.md',
    content: '17 * 23 = 17 * 20 + 17 * 3 = 340 + 51 = 391',
    content_type: 'text/markdown',
    agent_id: 'peer-agent',
  });
  await peer.call('channel_send', {
    content: '391',
    intent: 'result',
    parent_message_id: got.message_id,
    refs: [mem.uri],
    agent_id: 'peer-agent',
  });
  lap('peer replied with result + memory ref');

  let answer;
  for (let i = 0; i < 6 && !answer; i++) {
    const w = await host.call('channel_wait', { timeout_s: 50 });
    answer = w.messages.find((m) => m.intent === 'result' && m.body?.parent_message_id === got.message_id);
  }
  check(answer?.body?.text === '391' && answer.verified, 'host received the result');

  const read = await host.call('memory_read', { uri: answer.refs[0] });
  check(read.verified && read.content.includes('391') && read.author === peerAddr, 'host read peer memory, author signature verified');

  const v = await host.call('identity_verify', { message_id: answer.message_id });
  check(v.verified && v.sender === peerAddr, 'identity_verify confirms the peer signed the result');

  lap('PASS');
} finally {
  await host.client.close();
  await peer.client.close();
}
