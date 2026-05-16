import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LogEntry {
  ts: string;
  tool: string;
  durationMs: number;
  errorCode: string | null;
  inputHash: string;
}

export class ToolLog {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  todayFile(): string {
    const d = new Date().toISOString().slice(0, 10);
    return join(this.dir, `${d}.jsonl`);
  }

  inputHash(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
  }

  record(entry: Omit<LogEntry, 'ts'>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    appendFileSync(this.todayFile(), line + '\n', 'utf-8');
  }

  tail(limit: number): LogEntry[] {
    const f = this.todayFile();
    if (!existsSync(f)) return [];
    const lines = readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as LogEntry);
  }
}
