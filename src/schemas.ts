import { z } from 'zod';

const SuiAddress = z.string().regex(/^0x[a-fA-F0-9]+$/, 'invalid Sui address');
const UUID = z.string().min(1);

export const WalrusUriSchema = z.string().regex(/^walrus:\/\//, 'must start with walrus://');

export const ChannelCreateArgs = z.object({
  name: z.string().min(1),
  members: z.array(SuiAddress).optional(),
});
export type ChannelCreateArgs = z.infer<typeof ChannelCreateArgs>;

export const ChannelInviteArgs = z.object({
  channel_id: UUID,
  address: SuiAddress,
});
export const ChannelKickArgs = ChannelInviteArgs;
export const ChannelLeaveArgs = z.object({ channel_id: UUID });
export const ChannelMembersArgs = z.object({ channel_id: UUID });
export const ChannelJoinArgs = z.object({ channel_id: UUID });

export const ChannelSendArgs = z.object({
  channel_id: UUID,
  content: z.string(),
  refs: z.array(WalrusUriSchema).optional(),
  agent_id: z.string().optional(),
  parent_message_id: UUID.optional(),
});

export const ChannelHistoryArgs = z.object({
  channel_id: UUID,
  since: z.number().int().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const MemoryWriteArgs = z.object({
  channel_id: UUID,
  key: z.string().min(1).max(256),
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
  channel_id: UUID,
});

export const SystemDebugArgs = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});

export const EmptyArgs = z.object({});
