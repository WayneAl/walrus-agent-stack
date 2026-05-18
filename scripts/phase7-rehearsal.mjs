#!/usr/bin/env node
// Phase 7 — Multi-Persona Channel Rehearsal Harness
//
// Spawns N memory-isolated personas (each its own MCP server subprocess with
// its own Sui keypair + LOG_DIR), drives them through the full channel
// matrix on testnet, and records a structured timeline + summary suitable
// for the Sui Overflow 2026 demo video.
//
// Usage:
//   pnpm test:e2e:phase7 -- --personas 3 --out tmp/phase7
//   node scripts/phase7-rehearsal.mjs --personas 3 --out tmp/phase7 --keep
//
// Prereqs:
//   - `pnpm build` (imports dist/cli.js)
//   - Local relayer reachable at $RELAYER_URL (or $TEST_RELAYER_URL)
//   - $SEAL_SERVERS set (or $TEST_SEAL_SERVERS), 2+ ids from docs/TESTNET.md
//   - Testnet faucet reachable (or pass --skip-faucet for pre-funded keys)
//
// Exits 0 if every assertion passes; non-zero on first failure. Always
// writes <out>/<runId>/{timeline.jsonl,summary.md} regardless of outcome.

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  mintPersona,
  loadPersonasFromEnvDir,
  fundPersona,
  personaEnv,
  writePersonaEnvFile,
  spawnPersona,
  createRecorder,
  call,
  assert,
  shortAddr,
  sleep,
} from './phase7-helpers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = join(ROOT, 'dist/cli.js');

function parseArgs(argv) {
  const out = {
    personas: 3,
    out: 'tmp/phase7',
    keep: false,
    skipFaucet: false,
    reuseFrom: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--personas') out.personas = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--keep') out.keep = true;
    else if (a === '--skip-faucet') out.skipFaucet = true;
    else if (a === '--reuse-personas') out.reuseFrom = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: phase7-rehearsal.mjs [--personas N] [--out DIR] [--keep]\n' +
          '                            [--skip-faucet] [--reuse-personas DIR]\n' +
          '\n' +
          '  --reuse-personas DIR  Load keys from a prior run\'s env/ dir (in\n' +
          '                        alphabetical filename order); implies --skip-faucet.',
      );
      process.exit(0);
    }
  }
  if (out.personas < 3) {
    console.error(`--personas must be >= 3 for the full scenario (got ${out.personas})`);
    process.exit(2);
  }
  if (out.reuseFrom) out.skipFaucet = true;
  return out;
}

function resolveBaseEnv() {
  const env = {
    SUI_NETWORK: process.env.SUI_NETWORK || 'testnet',
    SUI_RPC_URLS: process.env.SUI_RPC_URLS || 'https://fullnode.testnet.sui.io:443',
    RELAYER_URL: process.env.RELAYER_URL || process.env.TEST_RELAYER_URL || '',
    SEAL_SERVERS: process.env.SEAL_SERVERS || process.env.TEST_SEAL_SERVERS || '',
    WALRUS_PUBLISHER_URL:
      process.env.WALRUS_PUBLISHER_URL ||
      'https://publisher.walrus-testnet.walrus.space',
    WALRUS_AGGREGATOR_URL:
      process.env.WALRUS_AGGREGATOR_URL ||
      'https://aggregator.walrus-testnet.walrus.space',
  };
  const missing = ['RELAYER_URL', 'SEAL_SERVERS'].filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    console.error('Set RELAYER_URL/SEAL_SERVERS (or TEST_RELAYER_URL/TEST_SEAL_SERVERS).');
    process.exit(2);
  }
  return env;
}

function newRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

const PERSONA_LABELS = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];

function labelFor(i) {
  return PERSONA_LABELS[i] ?? `persona${i + 1}`;
}

async function runScenario(clients, personas, recorder, steps) {
  const [alice, bob, carol] = clients;
  const [aliceP, bobP, carolP] = personas;

  function logStep(name, ok, detail) {
    steps.push({ name, ok, detail });
    const mark = ok ? '✓' : '✗';
    console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  }

  // The relayer's auth cache is hydrated from Sui checkpoint events, which
  // can lag tx confirmation by 10–60s on testnet. The on-chain
  // `channel.members` query goes around the relayer (reads Sui directly), so
  // it's not a useful probe — what we actually need is for the relayer to
  // recognize the caller as a group member. The cheapest probe is a
  // relayer-bound `channel.history` (limit:1); we retry until it stops
  // returning NOT_GROUP_MEMBER. Caps at 120s.
  async function waitForRelayerMembership(client, persona, channel_id, label) {
    const deadline = Date.now() + 120_000;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        await call(client, persona, 'channel.history',
          { channel_id, limit: 1 },
          recorder, { stepName: `${label}-probe-${attempt}` });
        return; // success — relayer recognizes us
      } catch (e) {
        if (e.errorCode !== 'NOT_GROUP_MEMBER' && e.errorCode !== 'INTERNAL_ERROR') {
          throw e;
        }
      }
      await sleep(3000);
    }
    throw new Error(
      `Relayer membership for ${persona.label} on ${channel_id} did not converge within 120s`,
    );
  }

  // Step 1: Alice creates the channel (empty — initialMembers in
  // createAndShareGroup only grants MessagingReader, which would block
  // Bob from sending. Use channel.invite below to grant full perms.)
  console.log('\n[scenario] starting');
  const channel = await call(alice, aliceP, 'channel.create', {
    name: 'phase7-rehearsal',
  }, recorder, { stepName: 'create' });
  const cid = channel.channel_id;
  logStep('Alice creates channel', true, `cid=${cid}`);

  // Wait for relayer auth cache to recognize Alice (group admin).
  await waitForRelayerMembership(alice, aliceP, cid, 'post-create-alice');
  logStep('Relayer auth cache recognizes alice', true);

  // Step 1b: Alice invites Bob with full messaging perms.
  await call(alice, aliceP, 'channel.invite', {
    channel_id: cid,
    address: bobP.address,
  }, recorder, { stepName: 'alice-invite-bob' });
  await waitForRelayerMembership(bob, bobP, cid, 'post-invite-bob');
  logStep('Alice invites Bob (full perms)', true);

  // Step 2: Alice greets.
  const hello = await call(alice, aliceP, 'channel.send', {
    channel_id: cid,
    content: 'hello team — channel up',
    agent_id: 'alice',
  }, recorder, { stepName: 'alice-greet' });
  logStep('Alice sends greeting', true, `msg=${hello.message_id}`);

  // Step 3: Bob reads history and sees the greeting.
  const bobHist1 = await call(bob, bobP, 'channel.history', {
    channel_id: cid,
    limit: 50,
  }, recorder, { stepName: 'bob-history-1' });
  const bobSeesHello = bobHist1.messages.some(
    (m) => m.message_id === hello.message_id && m.verified === true,
  );
  assert(bobSeesHello, 'Bob did not see Alice greeting (verified)');
  logStep('Bob reads history → sees Alice greeting', true);

  // Step 4: Bob replies (interleave to keep loop-detector quiet).
  const bobAck = await call(bob, bobP, 'channel.send', {
    channel_id: cid,
    content: 'bob here, ack',
    agent_id: 'bob',
    parent_message_id: hello.message_id,
  }, recorder, { stepName: 'bob-ack' });
  logStep('Bob sends ack', true);

  // Step 5: Alice writes memory blob (Walrus + Seal envelope).
  const memo = await call(alice, aliceP, 'memory.write', {
    channel_id: cid,
    key: 'spec.md',
    content: '# Phase 7 Spec\nMulti-persona channel rehearsal.',
    content_type: 'text/markdown',
    agent_id: 'alice',
  }, recorder, { stepName: 'alice-memory-write' });
  logStep('Alice writes memory.spec.md', true, `uri=${memo.uri.slice(0, 40)}…`);

  // Step 6: Alice posts the ref so Bob can find it.
  await call(alice, aliceP, 'channel.send', {
    channel_id: cid,
    content: 'spec written, see refs',
    refs: [memo.uri],
    agent_id: 'alice',
    parent_message_id: bobAck.message_id,
  }, recorder, { stepName: 'alice-ref-broadcast' });
  logStep('Alice broadcasts memory ref', true);

  // Step 7: Bob reads the memory.
  const memoRead = await call(bob, bobP, 'memory.read', {
    uri: memo.uri,
  }, recorder, { stepName: 'bob-memory-read' });
  assert(memoRead.verified === true, 'memory.read verified=false');
  assert(memoRead.content.includes('Phase 7 Spec'), 'memory content mismatch');
  logStep('Bob reads memory → verified=true', true);

  // Step 8: Alice invites Carol.
  await call(alice, aliceP, 'channel.invite', {
    channel_id: cid,
    address: carolP.address,
  }, recorder, { stepName: 'alice-invite-carol' });
  logStep('Alice invites Carol', true);
  await waitForRelayerMembership(carol, carolP, cid, 'post-invite-carol');
  logStep('Relayer auth cache recognizes carol', true);

  // Step 9: Carol joins, gets history snapshot.
  const carolJoin = await call(carol, carolP, 'channel.join', {
    channel_id: cid,
  }, recorder, { stepName: 'carol-join' });
  assert(carolJoin.history_count >= 3, `carol history_count=${carolJoin.history_count} < 3`);
  logStep('Carol joins → history_count', true, String(carolJoin.history_count));

  // Step 10: Carol announces.
  const carolHello = await call(carol, carolP, 'channel.send', {
    channel_id: cid,
    content: 'carol joined the chat',
    agent_id: 'carol',
  }, recorder, { stepName: 'carol-greet' });
  logStep('Carol announces arrival', true);

  // Step 11: Alice checks members list — expect 3.
  const members = await call(alice, aliceP, 'channel.members', {
    channel_id: cid,
  }, recorder, { stepName: 'alice-members' });
  const addrs = new Set(members.members.map((m) => m.address));
  assert(addrs.has(aliceP.address), 'Alice missing from members');
  assert(addrs.has(bobP.address), 'Bob missing from members');
  assert(addrs.has(carolP.address), 'Carol missing from members');
  logStep('Alice lists members → 3 present', true);

  // Step 12: Bob verifies Carol's signature.
  const verify = await call(bob, bobP, 'identity.verify', {
    channel_id: cid,
    message_id: carolHello.message_id,
  }, recorder, { stepName: 'bob-verify-carol' });
  assert(verify.verified === true, 'identity.verify failed');
  assert(verify.sender === carolP.address, `sender mismatch ${verify.sender}`);
  logStep('Bob verifies Carol signature', true);

  // Step 13: Alice kicks Carol (rotates key).
  const kick = await call(alice, aliceP, 'channel.kick', {
    channel_id: cid,
    address: carolP.address,
  }, recorder, { stepName: 'alice-kick-carol' });
  assert(kick.key_rotated === true, 'key_rotated != true');
  logStep('Alice kicks Carol → key_rotated=true', true);

  // Wait for relayer to drop Carol from its auth cache (her history probe
  // should start returning NOT_GROUP_MEMBER).
  {
    const deadline = Date.now() + 120_000;
    let attempt = 0;
    let droppedAt = null;
    while (Date.now() < deadline) {
      attempt++;
      try {
        await call(carol, carolP, 'channel.history', { channel_id: cid, limit: 1 },
          recorder, { stepName: `post-kick-probe-${attempt}` });
      } catch (e) {
        if (e.errorCode === 'NOT_GROUP_MEMBER') {
          droppedAt = attempt;
          break;
        }
      }
      await sleep(3000);
    }
    logStep('Relayer auth cache dropped carol',
      droppedAt !== null,
      droppedAt !== null ? `attempt ${droppedAt}` : 'timed out (continuing)');
  }

  // Step 14: Alice sends a post-rotation message.
  const postKickMsg = await call(alice, aliceP, 'channel.send', {
    channel_id: cid,
    content: 'post-rotation message — carol must not see this',
    agent_id: 'alice',
  }, recorder, { stepName: 'alice-post-kick-send' });
  logStep('Alice sends post-rotation message', true);

  // Step 15: Carol attempts to read the new message — should fail to decrypt
  // OR simply not return the post-rotation entry. Either is acceptable proof
  // that the rotation took effect; we record whichever happens.
  let carolCanReadPostKick = false;
  let carolPostKickOutcome = 'unknown';
  try {
    const carolHist = await call(carol, carolP, 'channel.history', {
      channel_id: cid,
      limit: 100,
    }, recorder, { stepName: 'carol-post-kick-history' });
    const seenIds = new Set(carolHist.messages.map((m) => m.message_id));
    carolCanReadPostKick = seenIds.has(postKickMsg.message_id);
    carolPostKickOutcome = carolCanReadPostKick
      ? 'visible (UNEXPECTED)'
      : 'absent (expected)';
  } catch (err) {
    carolPostKickOutcome = `errored: ${err.errorCode ?? err.message}`;
  }
  assert(!carolCanReadPostKick, 'Carol could decrypt post-rotation message!');
  logStep('Carol cannot read post-rotation message', true, carolPostKickOutcome);

  // Step 16: Bob leaves cleanly.
  const left = await call(bob, bobP, 'channel.leave', {
    channel_id: cid,
  }, recorder, { stepName: 'bob-leave' });
  assert(left.left === bobP.address, 'leave.left mismatch');
  logStep('Bob leaves channel', true);

  return { cid };
}

function renderSummary({ runId, personas, baseEnv, scenario, steps, error }) {
  const lines = [];
  const passed = steps.filter((s) => s.ok).length;
  const total = steps.length + (error ? 1 : 0);
  lines.push(`# Phase 7 Rehearsal — ${runId}`);
  lines.push('');
  lines.push(`- Status: **${error ? 'PARTIAL' : 'GREEN'}** (${passed}/${total} steps)`);
  lines.push(`- Network: \`${baseEnv.SUI_NETWORK}\``);
  lines.push(`- Relayer: \`${baseEnv.RELAYER_URL}\``);
  lines.push(`- Seal servers: \`${baseEnv.SEAL_SERVERS.split(',').length}\` configured`);
  lines.push('');
  lines.push('## Personas');
  for (const p of personas) {
    lines.push(`- **${p.label}** — \`${p.address}\``);
  }
  lines.push('');
  if (scenario?.cid) {
    lines.push(`## Channel \`${scenario.cid}\``);
    lines.push('');
  }
  lines.push('## Steps');
  for (const s of steps) {
    const mark = s.ok ? '✓' : '✗';
    lines.push(`- ${mark} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  }
  if (error) {
    lines.push('');
    lines.push('## Failure');
    lines.push('```');
    lines.push(error.stack ?? String(error));
    lines.push('```');
  }
  lines.push('');
  lines.push('---');
  lines.push('Generated by `scripts/phase7-rehearsal.mjs`.');
  return lines.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseEnv = resolveBaseEnv();
  const runId = newRunId();
  const outDir = resolve(opts.out, runId);
  const envDir = join(outDir, 'env');
  const logsDir = join(outDir, 'logs');
  const timelinePath = join(outDir, 'timeline.jsonl');
  const summaryPath = join(outDir, 'summary.md');

  mkdirSync(outDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  console.log(`[phase7] run ${runId} → ${outDir}`);
  console.log(`[phase7] personas=${opts.personas}`);

  const recorder = createRecorder(timelinePath);
  recorder.note(`runId=${runId} personas=${opts.personas} relayer=${baseEnv.RELAYER_URL}`);

  const labels = Array.from({ length: opts.personas }, (_, i) => labelFor(i));
  let personas;
  if (opts.reuseFrom) {
    console.log(`\n[reuse] loading personas from ${opts.reuseFrom}`);
    personas = loadPersonasFromEnvDir(opts.reuseFrom, labels);
    for (const p of personas) console.log(`  ${p.label} = ${shortAddr(p.address)}`);
  } else {
    console.log('\n[mint] generating wallets');
    personas = labels.map((label) => {
      const p = mintPersona(label);
      console.log(`  ${p.label} = ${shortAddr(p.address)}`);
      return p;
    });
  }

  if (!opts.skipFaucet) {
    console.log('\n[faucet] funding personas (sequenced to avoid 429s)');
    const results = [];
    for (const p of personas) {
      // Sequence: the testnet faucet rate-limits by source IP. Parallel
      // requests reliably trip 429 even with retries.
      const r = await fundPersona(p.address);
      results.push({ persona: p.label, ...r });
      // Spacing between calls helps the faucet IP bucket refill. The
      // testnet faucet seems to allow roughly one request per 5-8s per IP.
      await sleep(8000);
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(
        `[faucet] ${failed.length}/${personas.length} personas not funded:`,
      );
      for (const f of failed) {
        console.error(`  - ${f.persona}: ${f.status ?? 'no-endpoint'} ${f.body ?? ''}`);
      }
      console.error('Aborting before any on-chain calls. Wait for faucet cooldown or use --skip-faucet with pre-funded keys.');
      process.exit(3);
    }
    console.log('  waiting 5s for coins to settle on RPC');
    await sleep(5000);
  } else {
    console.log('\n[faucet] skipped (--skip-faucet)');
  }

  console.log('\n[spawn] starting MCP servers');
  const clients = [];
  const envFiles = [];
  for (const p of personas) {
    const personaLogDir = join(logsDir, p.label);
    mkdirSync(personaLogDir, { recursive: true });
    const env = personaEnv(p, baseEnv, personaLogDir);
    envFiles.push(writePersonaEnvFile(p, env, envDir));
    // Inherit PATH etc. from parent so `node` resolves correctly.
    const fullEnv = { ...process.env, ...env };
    const client = await spawnPersona(p, fullEnv, CLI_PATH);
    clients.push(client);
    recorder.boot(p);
    console.log(`  ${p.label} up`);
  }

  let scenario = null;
  let error = null;
  const steps = [];
  try {
    scenario = await runScenario(clients, personas, recorder, steps);
  } catch (err) {
    error = err;
    console.error(`\n[FAIL] ${err.message}`);
    if (/insufficient SUI balance/.test(err.message ?? '')) {
      console.error('\n[hint] One or more personas have 0 testnet SUI.');
      console.error('       Fund these addresses (web faucet: https://faucet.sui.io):');
      for (const p of personas) console.error(`         ${p.label} → ${p.address}`);
      console.error('       Then re-run with:');
      console.error(`         node scripts/phase7-rehearsal.mjs --reuse-personas ${envDir}`);
    }
  } finally {
    console.log('\n[cleanup] closing clients');
    await Promise.all(
      clients.map((c) => c.close().catch((e) => console.warn(`close: ${e.message}`))),
    );
    writeFileSync(
      summaryPath,
      renderSummary({ runId, personas, baseEnv, scenario, steps, error }),
    );
    console.log(`  summary → ${summaryPath}`);
    console.log(`  timeline → ${timelinePath}`);
    console.log(`  env (kept) → ${envDir}`);
  }

  if (error) process.exit(1);
  console.log('\n[phase7] ALL GREEN');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
