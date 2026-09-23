import { describe, it, expect } from 'vitest';
import {
  ChannelCreateArgs,
  ChannelSendArgs,
  MemoryWriteArgs,
  IdentityVerifyArgs,
  WalrusUriSchema,
} from '../../src/schemas.js';

describe('schemas', () => {
  it('ChannelCreateArgs requires name', () => {
    expect(ChannelCreateArgs.safeParse({}).success).toBe(false);
    expect(ChannelCreateArgs.safeParse({ name: 'x' }).success).toBe(true);
    expect(ChannelCreateArgs.safeParse({ name: 'x', members: ['0xa'] }).success).toBe(true);
  });

  it('ChannelSendArgs requires content; channel_id optional; validates to/intent', () => {
    expect(ChannelSendArgs.safeParse({ channel_id: 'abc', content: 'hi' }).success).toBe(true);
    expect(ChannelSendArgs.safeParse({ content: 'hi' }).success).toBe(true);
    expect(ChannelSendArgs.safeParse({ channel_id: 'abc' }).success).toBe(false);
    expect(ChannelSendArgs.safeParse({ content: 'hi', to: '*', intent: 'task' }).success).toBe(true);
    expect(ChannelSendArgs.safeParse({ content: 'hi', to: '0xabc' }).success).toBe(true);
    expect(ChannelSendArgs.safeParse({ content: 'hi', to: 'bob' }).success).toBe(false);
    expect(ChannelSendArgs.safeParse({ content: 'hi', intent: 'order' }).success).toBe(false);
  });

  it('MemoryWriteArgs requires key, content; channel_id optional', () => {
    expect(
      MemoryWriteArgs.safeParse({ channel_id: 'c', key: 'k', content: 'v' }).success,
    ).toBe(true);
    expect(MemoryWriteArgs.safeParse({ key: 'k', content: 'v' }).success).toBe(true);
    expect(MemoryWriteArgs.safeParse({ channel_id: 'c', key: 'k' }).success).toBe(false);
  });

  it('IdentityVerifyArgs requires message_id; channel_id optional', () => {
    expect(IdentityVerifyArgs.safeParse({}).success).toBe(false);
    expect(IdentityVerifyArgs.safeParse({ message_id: 'm' }).success).toBe(true);
    expect(IdentityVerifyArgs.safeParse({ message_id: 'm', channel_id: 'c' }).success).toBe(true);
  });

  it('WalrusUriSchema validates walrus:// URIs', () => {
    expect(WalrusUriSchema.safeParse('walrus://blob123').success).toBe(true);
    expect(WalrusUriSchema.safeParse('walrus://blob123?channel=c&key=k').success).toBe(true);
    expect(WalrusUriSchema.safeParse('https://other').success).toBe(false);
  });
});
