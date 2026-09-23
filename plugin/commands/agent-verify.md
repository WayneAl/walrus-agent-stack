---
description: Verify a channel message's signature
argument-hint: <message_id> [channel_id]
allowed-tools: mcp__plugin_walrus-agent-stack_walrus-agent-stack__*
---

# /agent-verify

Call `identity_verify` with `message_id` = the first argument (and `channel_id` = the
second argument if given; otherwise the active channel is used).

`verified` is the SDK's own signature check (`senderVerified`): the message was signed by
the claimed sender's Sui address. There is no separate signature or hash to display.

Print:

```
Message: <message_id>
Channel: <channel_id>
Sender:  <sender>
Signed:  <timestamp_ms as ISO time>
Order:   <order>
Status:  VERIFIED   (or  NOT VERIFIED)
```

## Arguments
$ARGUMENTS
