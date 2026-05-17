# Demo Rehearsal — Fixes Log

Working notebook for T31–T33 (three rehearsal passes of the 5-minute D2 demo
script in `docs/superpowers/specs/2026-05-15-agent-stack-design.md` §6.1).

For each rough spot found during a rehearsal, log it here with: what
happened, what the fix is, where the fix landed (commit / prompt file /
slash command), and which rehearsal it's resolved by.

---

## Rehearsal #1 — dry run (date: TBD)

**Setup:**
- [ ] Two Claude Code windows, side-by-side, 1920×1080 minimum
- [ ] Both windows have plugin installed (`/plugin install walrus-agent-stack`)
- [ ] Two `~/.walrus-agent-stack/` configs, swapped via `HOME` override per window
- [ ] Both wallets funded on testnet (or mainnet once provider seal IDs in hand)
- [ ] Relayer running locally on `http://localhost:3000`
- [ ] Font size ≥ 18pt in both Claude Code windows
- [ ] Screen recording NOT yet started

**Walk through the 5-minute script unrecorded. Note every rough spot.**

### Issues observed

<!-- Template:
- **[#1]** What happened (be specific — which step, which window, which tool returned what).
  - **Root cause:** ...
  - **Fix:** prompt tweak in plugin/agents/<name>.md OR slash command in plugin/commands/<name>.md OR retry config bump OR script-level pause.
  - **Where landed:** commit <sha> / file <path>.
  - **Verified:** Rehearsal #2 / #3.
-->

_(none yet — fill during the walk-through)_

### Subagent ad-libs

_(track any subagent that deviated from its system prompt)_

### Tool surprises

_(track any tool that returned an unexpected shape or threw an unexpected error)_

### Pacing notes

_(steps where Claude Code was thinking longer than expected — candidates for
voice-over fillers or script trims)_

---

## Rehearsal #2 — full recording, polish pass (date: TBD)

Lock voice-over script word-for-word after this pass.

**Setup additions:**
- [ ] Microphone tested (10-second voice memo, listened back)
- [ ] All macOS notifications silenced (`Do Not Disturb` on)
- [ ] Wifi confirmed stable (run a speedtest)
- [ ] Backups: `.env.alice`, `.env.bob`, mainnet wallet keypair stored in a
  password manager (NOT on disk in plaintext)

### Voice-over script (final)

_(paste the locked script here after this pass)_

### Pacing fixes

_(adjustments — pauses to add, sentences to cut, slash commands to demo
faster, etc.)_

### Prompt tightens

_(if any subagent goes off-script, tighten its system prompt with explicit
"first step: call <tool> with format X")_

---

## Rehearsal #3 — recording quality (date: TBD)

Pre-flight checklist:

- [ ] Mainnet wallets each have ≥ 3 SUI (or testnet wallets each have
  ≥ 3 SUI if demoing on testnet)
- [ ] `/agent-stack health` returns `ok` on **both** windows
- [ ] Walrus aggregator latency < 2 s (`time curl -sS
  https://aggregator.walrus-testnet.walrus.space/v1/blobs/<known-id> > /dev/null`)
- [ ] Microphone test (10-second record + listen back)
- [ ] No notifications enabled on macOS
- [ ] Wifi stable
- [ ] No extra Chrome tabs / Slack / Discord pinging

### Recording attempts

- [ ] Attempt #1 — outcome / kept-or-redo
- [ ] Attempt #2 — outcome / kept-or-redo

Pick the better take. Save both `.mov` files until after edit + upload.

---

## Post-rehearsal cleanup

After Rehearsal #3 yields a usable take:

- [ ] Commit final prompt / slash-command tweaks under a single commit
  message `chore: demo rehearsal final polish`.
- [ ] Update `<TODO: add demo recording URL>` in `README.md` after upload.
- [ ] Verify `pnpm test` still passes (rehearsals shouldn't touch test code,
  but confirm).
