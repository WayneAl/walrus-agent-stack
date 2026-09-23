import { z } from 'zod';

const SuiAddress = z.string().regex(/^0x[a-fA-F0-9]+$/, 'invalid Sui address');
const UUID = z.string().min(1);
// Omitted → the session's active channel (set by channel_create / channel_join).
const ChannelId = UUID.optional().describe(
  'Channel id; omit to use the active channel (set by channel_create / channel_join)',
);

export const WalrusUriSchema = z.string().regex(/^walrus:\/\//, 'must start with walrus://');

export const ChannelCreateArgs = z.object({
  name: z.string().min(1).describe('Human-readable channel name / topic'),
  members: z
    .array(SuiAddress)
    .optional()
    .describe('Sui addresses to invite with full send/read permissions'),
});
export type ChannelCreateArgs = z.infer<typeof ChannelCreateArgs>;

export const ChannelInviteArgs = z.object({
  channel_id: ChannelId,
  address: SuiAddress.describe('Sui address of the member'),
});
export const ChannelKickArgs = ChannelInviteArgs;
export const ChannelLeaveArgs = z.object({ channel_id: ChannelId });
export const ChannelMembersArgs = z.object({ channel_id: ChannelId });
export const ChannelJoinArgs = z.object({
  channel_id: UUID.describe('Channel id shared by the channel creator'),
});

export const MessageIntent = z.enum(['task', 'result', 'chat', 'done']);

export const ChannelSendArgs = z.object({
  channel_id: ChannelId,
  content: z.string().describe('Message text'),
  to: z
    .union([SuiAddress, z.literal('*')])
    .optional()
    .describe("Addressee's Sui address, or '*' for everyone"),
  intent: MessageIntent.optional().describe(
    'task = a request for the addressee; result = the answer to a task; chat = discussion; done = the collaboration is finished',
  ),
  refs: z
    .array(WalrusUriSchema)
    .optional()
    .describe('walrus:// URIs from memory_write for content too large for a message'),
  agent_id: z.string().optional().describe('Optional label for the sending agent/persona'),
  parent_message_id: UUID.optional().describe('message_id this replies to'),
});

export const ChannelHistoryArgs = z.object({
  channel_id: ChannelId,
  since: z
    .number()
    .int()
    .optional()
    .describe('Return only messages with order > since; omit to read from the start'),
  limit: z.number().int().min(1).max(500).default(100),
});

export const ChannelWaitArgs = z.object({
  channel_id: ChannelId,
  timeout_s: z.number().int().min(1).max(50).default(45).describe('Max seconds to wait (1-50)'),
  include_own: z
    .boolean()
    .default(false)
    .describe("Also return this agent's own messages"),
});

export const MemoryWriteArgs = z.object({
  channel_id: ChannelId,
  key: z.string().min(1).max(256).describe('Name for the entry, e.g. "report.md"'),
  content: z.string(),
  content_type: z.string().default('text/plain'),
  agent_id: z.string().optional(),
});

export const MemoryReadArgs = z.object({
  uri: WalrusUriSchema,
});

export const MemorySnapshotArgs = z.object({
  channel_id: UUID,
  label: z.string().min(1),
});

export const IdentityVerifyArgs = z.object({
  message_id: UUID,
  channel_id: ChannelId,
});

export const SystemDebugArgs = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});

export const EmptyArgs = z.object({});
