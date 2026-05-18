// Phase 7 rehearsal helpers — wallet mint, faucet, persona env, MCP spawn,
// transcript recorder. Pure ESM, no TypeScript build step required.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FAUCET_V2 = 'https://faucet.testnet.sui.io/v2/gas';
const FAUCET_V1 = 'https://faucet.testnet.sui.io/gas';

export function mintPersona(label) {
  const kp = new Ed25519Keypair();
  return {
    label,
    address: kp.toSuiAddress(),
    privateKey: kp.getSecretKey(),
  };
}

// Re-hydrate personas from a previously-kept env dir. Reads .env.<label>
// files in alphabetical order so the first N become alice/bob/carol/... by
// position rather than by filename label (so reuse works even if labels
// from a prior run differ).
export function loadPersonasFromEnvDir(envDir, labels) {
  const files = readdirSync(envDir)
    .filter((f) => f.startsWith('.env.'))
    .sort();
  if (files.length < labels.length) {
    throw new Error(
      `--reuse-personas: ${envDir} has ${files.length} .env files, need ${labels.length}`,
    );
  }
  return labels.map((label, i) => {
    const text = readFileSync(join(envDir, files[i]), 'utf8');
    const m = /^SUI_PRIVATE_KEY=(.+)$/m.exec(text);
    if (!m) throw new Error(`No SUI_PRIVATE_KEY in ${files[i]}`);
    const privateKey = m[1].trim();
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const kp = Ed25519Keypair.fromSecretKey(secretKey);
    return { label, address: kp.toSuiAddress(), privateKey };
  });
}

// Best-effort: parse the testnet faucet's "Wait for Ns" hint from a 429 body
// so we sleep the right amount instead of guessing. Falls back to 10s.
function parseRetryAfterSeconds(text) {
  const m = /Wait for (\d+)s/i.exec(text ?? '');
  return m ? Math.min(Number(m[1]), 30) : 10;
}

export async function fundPersona(address, log = console.log, { maxRetries = 10 } = {}) {
  const body = JSON.stringify({ FixedAmountRequest: { recipient: address } });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const url of [FAUCET_V2, FAUCET_V1]) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.ok) {
          log(`  faucet ok via ${url} -> ${address}`);
          return { ok: true, endpoint: url };
        }
        if (res.status === 404) continue;
        const text = await res.text().catch(() => '<no body>');
        if (res.status === 429 && attempt < maxRetries) {
          // The faucet's "Wait for Ns" hint is often misleading right after a
          // burst (it reports "0s" while the bucket is still empty). Use a
          // linear ramp keyed on attempt count, taking the larger of the
          // hint or the ramp.
          const hint = parseRetryAfterSeconds(text);
          const ramp = 5 + attempt * 5; // 10s, 15s, 20s, 25s, ...
          const wait = Math.max(hint, ramp);
          log(`  faucet 429 for ${address.slice(0, 10)}…; sleeping ${wait}s (attempt ${attempt}/${maxRetries}, hint=${hint}s)`);
          await sleep(wait * 1000);
          break; // retry from V2 again
        }
        log(`  faucet ${url} ${res.status}: ${text}`);
        return { ok: false, endpoint: url, status: res.status, body: text };
      } catch (err) {
        log(`  faucet ${url} threw: ${err?.message ?? String(err)}`);
      }
    }
  }
  return { ok: false, endpoint: null };
}

export function personaEnv(persona, baseEnv, logDir) {
  return {
    ...baseEnv,
    SUI_PRIVATE_KEY: persona.privateKey,
    LOG_DIR: logDir,
  };
}

export function writePersonaEnvFile(persona, env, dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `.env.${persona.label}`);
  const lines = Object.entries(env)
    .filter(([k]) => k === k.toUpperCase())
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
  return path;
}

export async function spawnPersona(persona, env, cliPath) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath],
    env,
  });
  const client = new Client({ name: `phase7-${persona.label}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

export function createRecorder(timelinePath) {
  mkdirSync(join(timelinePath, '..'), { recursive: true });
  writeFileSync(timelinePath, '');
  const events = [];

  function append(event) {
    const line = JSON.stringify(event);
    appendFileSync(timelinePath, line + '\n');
    events.push(event);
  }

  return {
    boot(persona) {
      append({
        ts: new Date().toISOString(),
        type: 'persona-up',
        persona: persona.label,
        address: persona.address,
      });
    },
    step(meta) {
      append({ ts: new Date().toISOString(), type: 'step', ...meta });
    },
    note(text) {
      append({ ts: new Date().toISOString(), type: 'note', text });
    },
    events: () => events,
  };
}

// Wrap a tool call: time it, parse result, record both args and result (or
// errorCode) to the recorder. Throws on tool error AFTER recording so the
// orchestrator can decide to swallow expected failures (e.g. post-kick read).
export async function call(client, persona, tool, args, recorder, { stepName } = {}) {
  const start = Date.now();
  let raw;
  try {
    raw = await client.callTool({ name: tool, arguments: args });
  } catch (err) {
    const latencyMs = Date.now() - start;
    recorder.step({
      persona: persona.label,
      address: persona.address,
      stepName,
      tool,
      args,
      latencyMs,
      errorCode: 'TRANSPORT_ERROR',
      errorMessage: err?.message ?? String(err),
    });
    throw err;
  }
  const latencyMs = Date.now() - start;
  const text = raw.content?.[0]?.text;
  if (raw.isError) {
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text };
    }
    recorder.step({
      persona: persona.label,
      address: persona.address,
      stepName,
      tool,
      args,
      latencyMs,
      errorCode: parsed?.code ?? 'TOOL_ERROR',
      errorMessage: parsed?.message ?? text,
    });
    const e = new Error(`Tool ${tool} errored: ${text}`);
    e.errorCode = parsed?.code ?? 'TOOL_ERROR';
    e.toolErrorBody = parsed;
    throw e;
  }
  if (!text) {
    recorder.step({
      persona: persona.label,
      address: persona.address,
      stepName,
      tool,
      args,
      latencyMs,
      errorCode: 'NO_CONTENT',
    });
    throw new Error(`No content from ${tool}: ${JSON.stringify(raw)}`);
  }
  const result = JSON.parse(text);
  recorder.step({
    persona: persona.label,
    address: persona.address,
    stepName,
    tool,
    args,
    result,
    latencyMs,
  });
  return result;
}

export function assert(cond, message) {
  if (!cond) {
    const e = new Error(`Assertion failed: ${message}`);
    e.isAssertion = true;
    throw e;
  }
}

export function shortAddr(a) {
  if (typeof a !== 'string') return String(a);
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;
}

// Sleep helper used between faucet + first on-chain op.
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
