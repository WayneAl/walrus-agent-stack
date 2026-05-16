---
description: Cryptographically verify a channel message
allowed-tools: mcp__walrus-agent-stack__*
---

# /agent-verify

Given a message_id (from $ARGUMENTS), call `identity.verify` with the current channel_id and the message_id.

The `verified` flag returned by `identity.verify` is the cryptographic verification result computed by the underlying sui-stack-messaging SDK (`senderVerified`), which checks that the on-chain message envelope was signed by the claimed sender's Sui address. There is no separate signature or payload hash to display — the SDK exposes only the boolean outcome.

Print a verification report:

```
Message: <message_id>
Channel: <channel_id>
Sender:  <sender>
Signed:  <timestamp_ms>
Order:   <order>
Status:  ✓ VERIFIED  (or  ✗ NOT VERIFIED)
```

This is the demo highlight — make it look authoritative.

## Args
$ARGUMENTS
