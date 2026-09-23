import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolError } from './mcp/dispatch.js';

/**
 * Per-install session state at `$WAS_HOME/session.json`.
 *
 * `cursors[channel]` is the highest message `order` this agent has already
 * seen; `null` means "seen nothing — read from the start" (orders start at 0
 * on the serverless transport and 1 on the relayer, so no number can stand in
 * for "before the first message"). A missing key means "never read".
 */
export interface SessionState {
  active_channel_id?: string;
  cursors: Record<string, number | null>;
}

export function sessionFile(home: string): string {
  return join(home, 'session.json');
}

export function readSession(home: string): SessionState {
  const f = sessionFile(home);
  if (!existsSync(f)) return { cursors: {} };
  const raw = JSON.parse(readFileSync(f, 'utf-8')) as Partial<SessionState>;
  return { ...raw, cursors: raw.cursors ?? {} };
}

export function writeSession(home: string, state: SessionState): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const f = sessionFile(home);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, f);
}

export function getActiveChannel(home: string): string | undefined {
  return readSession(home).active_channel_id;
}

export function setActiveChannel(home: string, channelId: string): void {
  writeSession(home, { ...readSession(home), active_channel_id: channelId });
}

/** `undefined` = never read; `null` = read from the start; number = last seen order. */
export function getCursor(home: string, channelId: string): number | null | undefined {
  const cursors = readSession(home).cursors;
  return channelId in cursors ? cursors[channelId] : undefined;
}

export function setCursor(home: string, channelId: string, order: number | null): void {
  const s = readSession(home);
  writeSession(home, { ...s, cursors: { ...s.cursors, [channelId]: order } });
}

/** Explicit `channel_id` wins; otherwise the active channel; otherwise NO_ACTIVE_CHANNEL. */
export function resolveChannelId(home: string, channelId: string | undefined): string {
  if (channelId) return channelId;
  const active = getActiveChannel(home);
  if (active) return active;
  const err: ToolError = {
    code: 'NO_ACTIVE_CHANNEL',
    message: 'No channel_id given and no active channel: create or join a channel first',
  };
  throw err;
}
