import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OutboxItem {
  id: string;
  tool: string;
  args: unknown;
  enqueuedAt: number;
  attempts: number;
}

export class Outbox {
  private file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'outbox.json');
    if (!existsSync(this.file)) writeFileSync(this.file, '[]');
  }

  private read(): OutboxItem[] {
    return JSON.parse(readFileSync(this.file, 'utf-8')) as unknown as OutboxItem[];
  }

  private write(items: OutboxItem[]): void {
    writeFileSync(this.file, JSON.stringify(items, null, 2));
  }

  enqueue(item: Omit<OutboxItem, 'enqueuedAt' | 'attempts'>): void {
    const items = this.read();
    items.push({ ...item, enqueuedAt: Date.now(), attempts: 0 });
    this.write(items);
  }

  pending(): OutboxItem[] {
    return this.read();
  }

  markDone(id: string): void {
    this.write(this.read().filter((i) => i.id !== id));
  }

  incrementAttempt(id: string): void {
    const items = this.read();
    const found = items.find((i) => i.id === id);
    if (found) {
      found.attempts++;
      this.write(items);
    }
  }
}
