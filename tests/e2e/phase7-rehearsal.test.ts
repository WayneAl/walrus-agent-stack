import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { hasIntegrationEnv } from '../integration/helpers/fixture.js';

/**
 * E2E wrapper around scripts/phase7-rehearsal.mjs. Gated on the same env vars
 * as the integration suite so `pnpm test` (no env) skips silently. CI runs
 * `pnpm test:e2e:phase7` directly instead of through vitest.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/phase7-rehearsal.mjs');

describe.skipIf(!hasIntegrationEnv())('phase 7 rehearsal', () => {
  it('runs the full 3-persona scenario end-to-end', () => {
    const out = mkdtempSync(join(tmpdir(), 'phase7-'));
    const res = spawnSync('node', [SCRIPT, '--personas', '3', '--out', out], {
      env: {
        ...process.env,
        RELAYER_URL: process.env.TEST_RELAYER_URL,
        SEAL_SERVERS: process.env.TEST_SEAL_SERVERS,
      },
      encoding: 'utf8',
      timeout: 180_000,
    });

    if (res.status !== 0) {
      // Surface stdout/stderr so a CI failure is debuggable from the log alone.
      console.error('--- phase7 stdout ---\n' + res.stdout);
      console.error('--- phase7 stderr ---\n' + res.stderr);
    }
    expect(res.status).toBe(0);

    // Find the run directory (single child under `out`).
    const runs = readdirSync(out);
    expect(runs.length).toBe(1);
    const runDir = join(out, runs[0]!);
    const timeline = join(runDir, 'timeline.jsonl');
    const summary = join(runDir, 'summary.md');

    expect(existsSync(timeline)).toBe(true);
    expect(existsSync(summary)).toBe(true);

    const events = readFileSync(timeline, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // 3 persona-up boots + the note + ≥16 scenario steps.
    expect(events.filter((e) => e.type === 'persona-up').length).toBe(3);
    const steps = events.filter((e) => e.type === 'step');
    expect(steps.length).toBeGreaterThanOrEqual(16);

    // Spot-check the key invariants from the scenario.
    const kick = steps.find((s) => s.stepName === 'alice-kick-carol');
    expect(kick?.result?.key_rotated).toBe(true);

    const memoRead = steps.find((s) => s.stepName === 'bob-memory-read');
    expect(memoRead?.result?.verified).toBe(true);

    const summaryText = readFileSync(summary, 'utf8');
    expect(summaryText).toContain('Phase 7 Rehearsal');
    expect(summaryText).toContain('key_rotated=true');
  }, 240_000);
});
