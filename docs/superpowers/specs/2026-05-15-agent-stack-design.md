# Walrus Agent Stack — Sui Overflow 2026 Walrus Track Design

> Status: **Reviewed Draft** — 全 5 sections + self-review 完成，待 user review
> Author: Wayne Kuo
> Date: 2026-05-15
> Project codename: `walrus-agent-stack`

---

## 0. Hackathon 脈絡

### 賽事

- **Sui Overflow 2026**, Walrus Track（Specialized Track）
- Walrus = Headline Partner（全 hackathon 頭號贊助）
- Track 定位：「Build AI agents and agentic workflows powered by Walrus as a verifiable data and memory layer.」

### 獎金

- 1st **$35,000** ｜ 2nd $15,000 ｜ 3rd $7,500 ｜ 4th $5,000
- 額外 $7,500 honorable mentions
- **50% 在 8/27 winners 公布時發 / 50% 必須 mainnet 部署成功才發**
- 若公布前已上 mainnet → 一次拿 100%

### 時程（PT）

- **5/7 – 6/21**：Building period（37 天，含今天 5/15）
- **6/21**：Submission deadline
- 7/8：Shortlist 公布
- 7/20–21：Demo Day（線上）
- 8/27：Winners 公布

### 評審權重

| 標準 | 權重 |
|---|---|
| Real-World Application | **50%** |
| Product & UX | 20% |
| Technical Implementation | 20% |
| Presentation & Vision | 10% |

→ **「解決真實問題、有市場相關、有長期價值」是壓倒性主軸**，技術炫不如故事真。

### 既有專案規則

> "Existing projects are permitted only if **substantial new functionality, features, or integrations are developed specifically during the hackathon period.**"

→ 可以基於現有的 `sui-stack-messaging`（被官方列為 Walrus track 推薦參考工具），但 hackathon 期間必須做出**夠分量、夠獨立**的新貢獻。

### 繳交 Checklist

- Public GitHub repo
- Demo video（YouTube 偏好，≤ 5 min）
- Project Name、Description、Logo (1:1)
- Deployment（Testnet 或 Mainnet）
- Package ID（若 on-chain）

---

## 1. Problem Statement 要點（Walrus Track）

核心命題：**Walrus = AI 的 Verifiable Data Platform**，解決 AI agents stateless、fragmented、context 無法跨 session/工具/團隊延續的根本問題。

要做的事：
1. **Long-term memory** — persistent, verifiable memory for agents
2. **Persistent data & file access** — via Walrus
3. **Integrations & tooling** — 讓開發者更容易接 Walrus / MemWal 進 agentic systems

特別感興趣的場景：
- Long-running workflows（research, trading, monitoring）
- Multi-agent coordination（協商、任務分派、跨 agent step-by-step 執行）
- Artifact-driven workflows

Tooling 方向：
- 為 agent framework 做 plugin/adapter
- Workflow orchestration（memory + messaging + execution）
- Cross-tool/cross-agent memory sharing
- Inspect / debug / manage agent memory 的開發者介面

---

## 2. 決策記錄（Decision Trail）

| # | 問題 | 選項 | 決定 |
|---|---|---|---|
| 1 | 主線方向 | A 展示型 dApp / **B 延伸 sui-stack-messaging 的 multi-agent coordination** / C 全新題 / D tooling | **B** |
| 2 | 目標使用者 | **1 Agent framework 開發者 (B2D)** / 2 企業 fleet / 3 C 端 / 4 你建議 | **1 (B2D)** |
| 3 | 整合機制 | A native SDK 雙語 / **B MCP server** / C HTTP gateway / D 純 TS SDK | **B (MCP server)** + Claude Code plugin |
| 4 | 團隊規模 | solo / 2人 / 3+ 人 | **solo** |
| 5 | Approach envelope | **1 Coordination + Memory** / 2 Memory-pure / 3 Inspector | **1** |
| 6 | Demo 故事 | D1 跨時間 / **D2 跨組織** / D3 跨設備接力 | **D2** |

### D2 demo 一句話

兩個錢包 / 兩個 user（Alice 與 Bob）在各自的 Claude Code 內，透過 walrus-agent-stack plugin 共享同一個加密 channel、互通 Walrus memory，並各自的 agent 簽章可被第三方驗證。

啟動的「跨」維度：**跨機器 + 跨信任域 + 第三方可驗證**。

---

## 2.5. 生態現況調查（2026-05-15）

| 對象 | 狀態 | 範圍 |
|---|---|---|
| 官方 sui-stack-messaging MCP server | **不存在** | — |
| 官方 Walrus MCP server | **不存在** | — |
| **MemWal MCP**（`@mysten-incubation/memwal-mcp`） | **已 ship（beta）** | 單一 owner / 跨自己 device & agent |
| MemWal SDK（`@mysten-incubation/memwal`） | 已 ship（beta） | 同上 |
| KlyntLabs sui-move-analyzer MCP | 已存在 | Move IDE，無關 |

**MemWal docs 完整快照** 已存到 `docs/superpowers/research/memwal/`（10 份頁面）供日後查閱。

### 2.5.1 MemWal Delegate Access 的真實語意（從 contract docs 直接擷取）

對 MemWal「delegate access = 跨用戶協作」是常見誤讀。從官方 docs 逐字驗證：

**Ownership and Permissions** 頁：
- Delegates **can**: store / recall / restore / decrypt
- Delegates **cannot**: add/remove other delegate keys / deactivate account / transfer ownership

**Delegate Key Management** 頁：
- "Apps need a usable key for API calls **without exposing the owner wallet**"
- "Different apps or devices can each have their own delegate key with a descriptive label"

**Memory Space** 頁：
- Memory space = `(owner_address, namespace, app_id)`
- **Each Sui address can only create ONE MemWalAccount** (enforced by AccountRegistry)

**MCP Reference** 對 `memwal_remember` 的描述：
- "Save a fact to **the user's** MemWal **personal** memory"

→ **結論**：MemWal delegate 是「同一個 owner 在多裝置 / 多 app / 多 agent 上的代理權」，不是「跨用戶協作」。

### 2.5.2 MemWal vs Walrus Agent Stack 能力比較

| 需求 | MemWal | sui-stack-messaging | **Walrus Agent Stack** |
|---|:-:|:-:|:-:|
| 個人記憶跨自己的 device / app / agent | ✅ | — | — |
| 個人 agent 跨 session 記得 user | ✅ | — | — |
| 加密 group messaging（多 owner） | ❌ | ✅ | reuse |
| Per-member 簽章 / 身分歸屬 | ❌ | ✅ | reuse |
| Group 共享的 memory（per-channel namespace） | ❌ | ⚠️ 僅 attachments | **新增** |
| 跨 owner 的 memory ACL（誰能讀某 blob） | ❌ | ✅ Seal + Group | reuse |
| 暴露 channel + memory primitives 給 agent 的 MCP | ❌ | ❌ | **新增** |
| Subagent template + Claude Code plugin 包裝 | ❌ | ❌ | **新增** |
| Cross-org agent 協作 + 第三方可驗證 | ❌ | ✅（人類用） | **新增**（agent 用） |

### 2.5.3 「為什麼 delegate 不能拿來做協作」的精確解釋

**技術上**你可以把自己的 MemWal delegate key 給 Bob 用——但這會發生：

| 現象 | 結果 |
|---|---|
| Bob 拿到 key 後動作 | 系統視為「owner 自己在動作」，無 Bob 身分痕跡 |
| Bob 寫入的 memory | 記在你的 account 名下，無 per-user 歸屬 |
| Bob 的權限粒度 | 整個 account 全讀全寫，沒有 per-namespace ACL for delegates |
| 第三方審計 | 看到的是「owner 的某把 delegate key」，無法區分是 Bob 或 Alice |
| 你想踢 Bob 出去 | 只能 revoke 整把 key，Bob 從此被完全切斷 |

這是 **「authorized agent acting AS you」** 模式，不是 **「co-tenant with own identity」** 模式。

跨組織協作必須要 co-tenant 模式：每個 owner 有自己的 Sui 身分、各自簽章、shared namespace 內各自歸屬可追溯——這正是 sui-stack-messaging 的設計（Group object + per-member signature + Seal ACL）。

### 2.5.4 策略定位（修正後）

| 層 | 產品 | 解決什麼 |
|---|---|---|
| 個人記憶層 | **MemWal MCP**（官方） | "remember what I told you yesterday" |
| **協作層** | **Walrus Agent Stack**（我們） | "remember what Bob's agent told my agent yesterday, with proof" |

**對外宣傳一句話**：
> MemWal 解決「agent 記得 user」；Walrus Agent Stack 解決「agents 互記、互動、互驗」。兩個 MCP 都裝上，就有完整 agent 記憶 + 協作 stack。

**互補同框 demo 機會**：D2 demo 中，Alice 同時裝 MemWal MCP（個人）+ Walrus Agent Stack MCP（協作）——展示 user 自己的 agent 記得 user 偏好（MemWal），同時與 Bob 的 agent 跨組織協作（我們）。

### 2.5.5 Memory 後端決策（修正後）

- **Channel-scoped 共享 memory**（D2 demo 核心）→ 直接用 Walrus + Seal，透過 sui-stack-messaging 既有 attachments path
  - 為什麼不走 MemWal SDK：MemWal 的 ownership model（單一 owner + delegates）與 channel ownership model（Group 多 member）根本性不相容
  - 為什麼走 sui-stack-messaging：它已經有「channel-scoped + Seal-encrypted + Walrus-stored」的 attachments，剛好是我們要的 primitive
- **不依賴 MemWal**——MemWal MCP 是「建議併用的鄰居產品」，不是我們的後端依賴

---

## 3. 產品定位

> **Walrus Agent Stack** — 給 AI agent 框架開發者用的 MCP server + Claude Code plugin，讓任何 MCP-compatible agent 立刻取得：
> 1. 加密 agent-to-agent 協作頻道（Sui + Seal + sui-stack-messaging）
> 2. 共享、持久、可驗證的 Walrus memory
> 3. 跨組織、跨機器、跨信任域的 agent identity 與簽章

Tagline（採用）：
> **"Walrus-backed shared memory + encrypted channels for any MCP agent"**

選擇理由：直接點出「what + for whom」，技術細節（Walrus / 加密 / MCP）一句話交代，比抽象的 "verifiable coordination layer" 更具體，比 "Slack + Dropbox" 類比更精準（避免被當社交工具誤解）。

---

## 4. Architecture（Section 1 — ✅ 已確認）

```
┌─ ALICE 端 ─────────────────────┐  ┌─ BOB 端 ─────────────────────┐
│ Claude Code                    │  │ Claude Code                    │
│  + agent-stack plugin          │  │  + agent-stack plugin          │
│  + 3 subagents                 │  │  + 3 subagents                 │
│  + /channel-* slash commands   │  │  + /channel-* slash commands   │
│         │ MCP (stdio)          │  │         │ MCP (stdio)          │
│  ┌──────▼──────────────┐       │  │  ┌──────▼──────────────┐       │
│  │ Local MCP server    │       │  │  │ Local MCP server    │       │
│  │  (TS, npx 啟動)     │       │  │  │                     │       │
│  │  + Alice 的 keypair  │       │  │  │  + Bob 的 keypair   │       │
│  └──────┬──────────────┘       │  │  └──────┬──────────────┘       │
└─────────┼──────────────────────┘  └─────────┼──────────────────────┘
          │                                    │
          └───────────┬────────────────────────┘
                      │ HTTPS (E2E ciphertext only)
              ┌───────▼────────┐
              │ Public Relayer │ ← reuse sui-stack-messaging
              │                │   既有 relayer template
              └───────┬────────┘
                      │
       ┌──────────────┼─────────────┐
       ▼              ▼             ▼
  ┌────────┐     ┌────────┐    ┌────────┐
  │  Sui   │     │ Walrus │    │  Seal  │
  │Groups  │     │ blobs  │    │ key 守 │
  │ + 簽章 │     │(memory)│    │ 護(門檻)│
  └────────┘     └────────┘    └────────┘
                      ▲
                      │
            ┌─────────┴──────┐
            │   Verifier     │  ← 任何拿到 channel ID +
            │ (Carol, 路人甲) │     read permission 的人
            └────────────────┘
```

### 關鍵設計決策

1. **MCP server 是 local process**，user 完全擁有自己的 keypair（對應 "data not locked into a single platform"）
2. **完全 reuse sui-stack-messaging 的 relayer**——不自己起新 relayer
3. **MCP server 直接 wrap sui-stack-messaging TS SDK 的 client extension**
4. **不寫新 Move package**——sui-groups + sui-stack-messaging 既有 on-chain object 已足夠
5. **Demo recording 對策**：solo 但 demo 兩個用戶——錄影時開兩個 Claude Code window（不同 profile / 不同 wallet），左右並排同演；底層 Sui 端真的有兩個錢包簽章

### 為什麼不另做 cloud service

- Real-World Application 50% 評分裡 "user-owned" 是強訊號
- 不用維運伺服器
- 與「Walrus = 去中心化資料層」敘事一致

---

## 5. Components（Section 2 — ✅ 已確認）

### 5.1 MCP Server: `walrus-agent-stack-mcp`

TypeScript package，stdio MCP server。底層 wrap sui-stack-messaging client extension。

**Exposed MCP Tools**：

| Tool | 行為 | 底層 |
|---|---|---|
| `channel.create({name, members?})` | 開新加密 channel，回傳 channel_id；caller 為 admin | sui-stack-messaging `createAndShareGroup` |
| `channel.invite({channel_id, address})` | 加成員（member 角色） | sui-groups member ops |
| `channel.kick({channel_id, address})` | 移除成員 + Seal key rotation | sui-groups `removeMemberAndRotateKey` |
| `channel.leave({channel_id})` | 自己離開 | sui-groups `leaveGroup` |
| `channel.members({channel_id})` | 列出當前成員與 admin | Group object read |
| `channel.join({channel_id})` | 訂閱（拉歷史 + 開即時 stream） | sui-stack-messaging `subscribe` |
| `channel.send({channel_id, content, refs?})` | 送訊息；refs 是 Walrus memory pointer list | `sendMessage` |
| `channel.history({channel_id, since?})` | 拿歷史訊息 | `getMessages` |
| `memory.write({channel_id, key, content})` | 寫 Walrus blob（channel-scoped），回傳 URI | Walrus + Seal (Group policy) |
| `memory.read({uri})` | 讀 Walrus blob（自動解 Seal） | Walrus + Seal |
| `memory.snapshot({channel_id, label})` | pin 當前 channel 整段狀態 + 引用 memory（stretch） | 組合操作 |
| `identity.whoami()` | 回傳這個 MCP server 的 Sui address | local keypair |
| `identity.verify({message_id})` | 驗證某訊息的簽章 + 對應發送者 | `senderVerified` |
| `system.health()` | 印 RPC / relayer / Walrus / Seal 健康狀態 | 健康檢查 |
| `system.resend()` | 重送本地 outbox 內未送出的訊息 | 失敗恢復 |
| `system.debug({limit?})` | 印最近 N 筆 tool call log | observability |

**設定**（env / config file）：
- `SUI_PRIVATE_KEY`（或 keychain 整合）
- `SUI_NETWORK=mainnet|testnet`
- `RELAYER_URL`
- `SEAL_SERVERS=[...]`

### 5.2 Claude Code Plugin: `walrus-agent-stack`

| 類別 | 名稱 | 用途 |
|---|---|---|
| MCP config | `walrus-agent-stack` server | 自動連 5.1 的 MCP server |
| Subagent | `research-leader` | 接題目、分派子任務、彙整 |
| Subagent | `analyst` | 收子任務、研究、寫 memory |
| Subagent | `synthesizer` | 讀 memory、產 report |
| Slash command | `/agent-channel new <topic>` | 建頻道、啟動 leader |
| Slash command | `/agent-channel invite <addr>` | 邀人 |
| Slash command | `/agent-channel join <id>` | Bob 端 join 用 |
| Slash command | `/agent-channel kick <addr>` | 踢人 + key rotation |
| Slash command | `/agent-channel leave` | 自己離開 |
| Slash command | `/agent-channel members` | 列成員 |
| Slash command | `/agent-memory list` | 列頻道內 memory refs |
| Slash command | `/agent-verify <msg_id>` | 顯示簽章驗證細節（demo 高光） |
| Slash command | `/agent-stack health` | 印環境健康狀態（demo 前必跑） |
| Slash command | `/agent-stack resend` | 重送 outbox |
| Slash command | `/agent-stack debug` | 印最近 20 筆 tool log |
| Hook | `Stop` | 任務結束自動把 session summary 寫 Walrus memory |

Subagent prompt 樣板明確指示 agent 用 `channel.send` 跟同伴講話、`memory.write` 存產出、`channel.history` 拉最新狀態。

### 5.3 Mainnet 部署準備

- 不寫新 Move
- sui-stack-messaging 既有 mainnet package 不動
- 公開 relayer endpoint（既有的或起一個 lightweight 的在 fly.io / railway）
- 一個 onboarding script: `npx walrus-agent-stack init` → 產 wallet、灌 SUI gas、寫 config

### 5.4 開源 Repo & Demo

- Public GitHub repo
- README：5 分鐘 quick start、架構圖、為什麼用 Walrus/Sui/Seal、comparison table
- 5 分鐘 demo video（YouTube）：D2 故事
- `docs/`：MCP tool reference、subagent guide、self-host 指南

### 5.5 明確不做（避免偷做）

- ❌ Python SDK（MCP 已跨語言）
- ❌ Web UI dashboard
- ❌ 新 Move package
- ❌ 多個 sample squad（只 research squad）
- ❌ Inspector 視覺化頁面（`/agent-verify` 取代）
- ❌ LangChain / CrewAI adapter（stretch goal，否則砍）
- ❌ 自架 Seal server

---

## 6. Data Flow（Section 3 — ✅ 已確認）

### 6.1 D2 Demo 完整步驟（5 分鐘錄影腳本，雙視窗左 Alice 右 Bob）

| # | 時間 | 視窗 | 動作 | 底層發生什麼 |
|---|---|---|---|---|
| 1 | 0:00–0:20 | Alice | `/agent-channel new "Stablecoin Regulation 2026"` | MCP `channel.create` → sui-stack-messaging `createAndShareGroup` → 新 Sui Group object（Alice = admin） |
| 2 | 0:20–0:30 | Alice | Spawn `research-leader` subagent，系統 prompt 內含 channel_id | Subagent template 灌入；leader 開始規劃 |
| 3 | 0:30–1:10 | Alice | Leader `channel.send` 宣告分工，spawn 2 個 `analyst`（US / EU 角度）| 訊息走 relayer，E2E 加密；訊息本體不上鏈 |
| 4 | 1:10–2:00 | Alice | 兩個 analyst 平行做研究，各自 `memory.write` 存 Walrus → `channel.send` 附 ref | 每個 blob 經 Seal 加密（policy = Group ACL）；訊息附 walrus URI |
| 5 | 2:00–2:20 | Alice | `/agent-channel invite 0xBob...` | sui-groups member ops 加 Bob；on-chain event 觸發 |
| 6 | 2:20–2:50 | Bob | `/agent-channel join <channel_id>` | `channel.subscribe` 拉歷史 → Seal 認證 Bob 在 Group → 自動解密所有歷史；Bob 看到完整對話 + Walrus refs |
| 7 | 2:50–3:40 | Bob | Spawn Bob 的 `analyst`；它 `memory.read` 看 Alice 那邊的發現，寫 critique，`channel.send` 帶 ref | Bob 的 keypair 簽章每條訊息與 blob metadata |
| 8 | 3:40–4:20 | Alice | Alice 的 `synthesizer` `channel.history` 全文 + `memory.read` 所有 refs → 產 final report → `memory.write` | Final blob 也是 Seal 加密 + 簽章 |
| 9 | 4:20–4:45 | Alice | `/agent-verify <bob_msg_id>` → 顯示 Bob 簽章 / timestamp / payload hash / Bob Sui address | sui-stack-messaging `senderVerified` 機制 |
| 10 | 4:45–5:00 | Alice | `/agent-memory list` → 列出每個 Walrus blob 的作者、簽章狀態、可重 verify | 一行一個 blob，標記 ✓ verified-by-author |

### 6.2 資料結構（重用 sui-stack-messaging，**不寫新 Move**）

**On-chain Sui objects**（既有）：
- `Group` object — `channel_id (UUID)`、`members: vector<address>`、`key_history`（Seal key rotation）、`metadata: KVStore`
- **訊息本體與 metadata 在 relayer，不上鏈**；on-chain 只記 Group 生命週期事件（create / addMember / removeMember / rotateKey / archive）
- 第三方審計靠：(a) on-chain Group 狀態 + 事件、(b) 每訊息 ed25519 簽章（off-chain 但可被任何人驗）、(c) Walrus blob 的 content-addressed 不可改性
- **新增的只有**：`Group.metadata` KV 塞兩個欄位：`walrus_agent_stack:version` + `walrus_agent_stack:role_map`（紀錄哪些 address 是 agent 角色 vs 人類）——可選，不做也行

**Channel message envelope**（在 relayer，E2E 加密）：

```ts
{
  id: UUID,
  channel_id: UUID,
  sender: 0x<sui_address>,         // wallet level
  timestamp_ms: number,
  payload: AES_256_GCM(ciphertext), // decrypted = MessageBody
  refs: walrus_uri[],              // optional memory pointers
  signature: ed25519(sender_keypair) // wallet signs envelope
}
```

`MessageBody`（解密後）：

```ts
{
  type: "text" | "memory_ref" | "agent_status" | "command",
  text?: string,
  agent_id?: string,         // sender process 內的 subagent label（例: "analyst-us"）
  parent_message_id?: UUID,  // threading
  custom?: object            // 擴充洞
}
```

**Walrus memory blob**：

```ts
encrypted_blob = SEAL.encrypt(
  policy: GroupAccessPolicy(channel_id),   // 重用 sui-stack-messaging attachments path
  data: {
    schema_version: 1,
    channel_id: UUID,
    key: string,             // 例: "analyst-us/findings.md"
    content_type: string,    // mime
    content: bytes,
    metadata: {
      author: 0x<sui_address>,
      author_agent_id: string,  // 例: "analyst-us"
      created_at_ms: number,
      message_id: UUID,         // 反指回 channel 訊息
      signature: ed25519(author_keypair)  // blob 內也簽一次
    }
  }
)
```

**為什麼 blob 內要再簽一次**：channel message 證明「Alice 在 T 時刻 post 了這個 URI」；blob 內簽章證明「URI 指向的內容也由 Alice 簽署」。兩層合在一起，第三方驗：Alice 在 T 時刻發布 + 內容由 Alice 簽署 + 與 channel 軌跡一致。

**Memory URI 格式**：
```
walrus://<blob_id>?channel=<channel_id>&key=<namespaced_key>
```

`channel` 與 `key` 是 hint（reader 知道 Seal policy 與 context）；真正權威是 content-addressed 的 `blob_id`。

### 6.3 第三方驗證流程（Carol 想驗「Bob 的 agent 真的說過 X」）

```
Carol 拿到 channel_id（被 Alice 加入 Group 為 reader）
        │
        ▼
1. channel.history(channel_id)
        │ relayer 回傳所有訊息（仍為 ciphertext，Carol 用自己 Seal share 解）
        ▼
2. 對每條訊息：verify ed25519(envelope, sender_pubkey)
        │   → 通過 = 該訊息確由 sender 那把 wallet 簽出
        │   ↳ sui-stack-messaging 既有 senderVerified
        ▼
3. 解密 payload → 拿 MessageBody，讀 refs[]
        ▼
4. 對每個 walrus_uri:
        │  a. Walrus download(blob_id)
        │  b. Seal decrypt（policy 檢查 Carol 在 Group）
        │  c. verify inner signature(blob.metadata.signature, blob.metadata.author)
        │  d. 比對 blob.metadata.message_id == 對應 channel 訊息 id
        ▼
5. 全部通過 → 「Bob 的 agent 在 T 時刻說了 X」cryptographically proven
```

### 6.4 篡改抵抗清單

| 攻擊面 | 後果 |
|---|---|
| 改 message envelope | envelope signature 不過 |
| 改 Walrus blob bytes | content hash 與 URI 不符 |
| 改 inner blob metadata | inner signature 不過 |
| 偽造 ref（塞不相關 blob 進 channel） | `message_id` cross-check 不過 |
| 改 on-chain Group state | 直接被 chain witness |
| Relayer 加塞訊息 | 沒有 sender keypair → 簽不出來 |
| Seal server 串通 | 需要超過門檻數量（committee 設計，非單點失效） |

### 6.5 不在 D2 demo 但可後加（stretch）

- `memory.snapshot({channel_id, label})` — 把當下整段 channel + 所有 refs 凍結成單一 Walrus blob（適合「report v1.0」這種需求）
- `identity.attest({agent_id, role})` — agent 自己 attestation 進 channel，宣告自身角色

## 7. Error Handling（Section 4 — ✅ 已確認）

依「失敗在哪一層」分組。原則：**fail fast、講清楚是誰的問題、永遠保留人工 recovery 路徑**。

### 7.1 Infrastructure 層

| 失敗模式 | 偵測 | MCP tool 行為 | 復原 |
|---|---|---|---|
| Relayer 暫時掛 / 超時 | HTTP 5xx 或 timeout (5s) | 回傳 `RELAYER_UNREACHABLE`；訊息暫存本地 outbox（簡單 JSON file） | Relayer 回來自動重送；或 `/agent-stack resend` 手動觸發 |
| Sui RPC 失敗 | RPC error / 500 | 退到備援 RPC（config 配兩個 endpoint）；寫操作 retry 3 次（exp backoff） | 都失敗 → 回 `SUI_RPC_DOWN`，agent 收到結構化錯誤 |
| Sui mainnet gas 不足 | TX 模擬時 pre-flight check | 不發 TX，回 `INSUFFICIENT_GAS` + 顯示需要金額與 sender address | `/agent-stack health` 顯示帳號狀態 + faucet 連結或 mainnet 充值提示 |
| Walrus blob 取不到（aggregator 失效 / 剛 publish 未 propagate） | Walrus client 404 / timeout | 自動換 aggregator（config 3 個）；最多 retry 30s（10 次 × 3s） | 仍失敗 → `WALRUS_UNAVAILABLE`；agent prompt 可選擇「等等再試」或「跳過此 ref」 |
| Walrus blob 永久遺失（過保存期未 renew） | Aggregator 410 Gone | 直接回 `BLOB_EXPIRED`，附原 URI 供 forensics | 不自動修復；human-in-the-loop |
| Seal server 門檻不足（committee 中 N 台掛掉） | Seal client `not enough shares` | 顯示哪幾台失效；嘗試 backup 列表 | weight 仍不足 → `SEAL_QUORUM_FAILED`；user/agent 自行決定等待或放棄 |

### 7.2 加密與權限層

| 失敗模式 | 偵測 | 行為 |
|---|---|---|
| 對方 wallet 不在 Group 卻試圖 subscribe | Seal `seal_approve` 拒絕 | `CHANNEL_ACCESS_DENIED`，附「請聯絡 admin 加入」 |
| 訊息簽章驗證失敗 | sui-stack-messaging `senderVerified=false` | **訊息不丟棄但 flag `unverified`**；agent prompt 必須先處理 verification 結果再用 |
| 自己被 revoke 後試圖讀新訊息 | Seal 拒絕新 key version | `MEMBERSHIP_REVOKED`；channel.history 仍可讀 revoke 前歷史（舊 key 版本在手上） |
| Bob 收到惡意人偽造的 channel_id | Fetch Group object → 對不上 admin claim | `CHANNEL_NOT_FOUND_OR_FORGED`，附 raw Sui object 連結 |
| Memory blob inner signature 不過 | 比對 blob.metadata.signature 失敗 | `MEMORY_TAMPERED`；該 ref 標 ⚠️，其他 refs 仍可用 |
| 同一 message_id 被兩個 blob 引用 | message_id cross-check 失敗 | 第二個被拒進 channel 顯示 |

### 7.3 Agent 行為層

| 失敗模式 | 偵測 | 行為 |
|---|---|---|
| Subagent crash 中途（OOM / cancel） | Claude Code subagent exit code != 0 | Channel 內留下 `agent_status: aborted`（hook 自動發）；其他 agent 可決定繼續或中止 |
| Subagent 拒絕呼叫 MCP tool（policy refuse） | Tool call 沒到達 MCP server | 不寫進 channel；本地 log only |
| Agent 寫一堆無關 memory（spam） | MemoryWrite call rate > 10/min | MCP 端 rate-limit；超過回 `RATE_LIMITED`，提示 prompt engineering 問題 |
| Agent 把 secret 寫進 channel | **不偵測**（prompt design 問題，不是 stack 問題） | README & subagent prompt 明確警告；demo 避免含 secret 情境 |
| Agent 不停 send_message 成 loop | 連續 N 條 sender 一樣且無 user input | MCP 統計，回 `LOOP_DETECTED`，由 Claude Code 主對話接手 |

### 7.4 使用者流程層

| 失敗模式 | 行為 |
|---|---|
| Alice 邀請寫錯地址 | 對方沒收到；`/agent-channel members` 看到錯地址，`/agent-channel kick` 移除 |
| Bob 加入後馬上想退出 | `/agent-channel leave` → sui-groups `leaveGroup`；本機 ciphertext 留著當記錄 |
| Channel ID 被傳到公開地方 | 沒事——權限是 on-chain Group 控制，非 secret-by-obscurity；外人看不到 ciphertext |
| Demo 錄影時 channel_id 露出 | 同上；demo 後可 `archiveGroup` 設 read-only 防新訊息 |
| Alice 想完全踢 Bob | `/agent-channel kick 0xBob` → `removeMemberAndRotateKey`：移除成員 + 新 Seal key 版本，Bob 從此讀不到新訊息 |

### 7.5 Demo Recording 當天的緊急預案

Solo + 直播風險最高。**錄影前**準備：

| 風險 | 預案 |
|---|---|
| Mainnet 卡 / TX 不上鏈 | 預先準備 testnet demo（env 一鍵切換）。主用 mainnet，後備 testnet |
| Walrus aggregator 集體不穩 | 配 3 個獨立 endpoint；錄前 30 分鐘各 health check |
| Seal server 暫時 down | 同上，配備援 |
| Subagent 不照腳本走 | Template prompt 用 **structured commands**（例：第一步必呼叫 `channel.send` 開場）；錄前 dry-run 至少 3 次 |
| Bob 那邊 RPC lag | 腳本**內建 30 秒 buffer**：Alice 邀請後喝口水講解 architecture，給 Bob 拉歷史時間 |
| MCP server 中途斷線 | `/agent-stack health` 隨時檢查；斷線 → restart MCP + 從上 checkpoint 接續 |
| 真錄壞了 | demo 分 3 段（setup / collaboration / verification）分段錄、後製拼接（hackathon 規則未禁） |

### 7.6 Logging 與 Observability（最簡可行）

- MCP server 把每次 tool call 記到 `~/.walrus-agent-stack/log/YYYY-MM-DD.jsonl`
- 欄位：tool name、`input_sha256`（**SHA-256(input JSON)，內容本身不存**）、duration_ms、error_code
- `/agent-stack debug` 印最近 20 筆
- **不**做 telemetry 上傳；user-owned 原則

### 7.7 明確不做（避免 scope creep）

- ❌ 自動 retry-with-exponential-backoff 跨所有 tool（只在 RPC / Walrus 層做）
- ❌ 訊息 eventual consistency 機制（下次 `channel.history` 抓到，夠用）
- ❌ Offline mode（沒網路 = 不能用，hackathon 可接受）
- ❌ Agent 行為 anomaly detection ML 模型（rate-limit + loop detection heuristic 夠）
- ❌ 自動 key 復原（key 遺失 = user 負責；wallet 安全是上游問題）

## 8. Testing（Section 5 — ✅ 已確認）

原則：**unit test 只做關鍵 invariant、integration test 跑得起 D2 demo、E2E 是 demo recording 本身的 rehearsal**。

### 8.1 測試金字塔（縮減版）

```
        ┌──────────────────┐
        │  Demo Rehearsals │   3 次以上完整錄影前演練
        ├──────────────────┤
        │   E2E (1 套)      │   雙 MCP server 跑完 D2
        ├──────────────────┤
        │  Integration     │   單 MCP server vs 真 testnet
        ├──────────────────┤
        │      Unit         │   只測 envelope sig / blob sig / URI 解析
        └──────────────────┘
```

### 8.2 Unit Tests（估 1-2 天）

純函數測試，**不碰網路 / 不碰鏈**。框架：vitest（與 sui-stack-messaging 一致）。

| 模組 | 必測項目 |
|---|---|
| `envelope.ts` | sign + verify round-trip / 改 byte 後 verify 必失敗 / timestamp out of range 拒絕 |
| `walrus-uri.ts` | parse `walrus://<id>?channel=&key=` / 缺少 channel/key 仍可解析 |
| `memory-blob.ts` | inner signature round-trip / cross-check message_id / schema_version 不認得時報錯 |
| `rate-limiter.ts` | 10/min 上限觸發 / 不同 channel 計數獨立 / 過期視窗滑動 |
| `loop-detector.ts` | 連 5 條同 sender 觸發 / user 介入後重置 |
| `mcp-tool-args.ts` | Zod schema 拒絕缺欄位 / 拒絕錯型別 / accept 合法輸入 |

### 8.3 Integration Tests（估 2-3 天）

**單一 MCP server，跑真 testnet + 真 relayer + 真 Walrus + 真 Seal。** 不 mock。

| Scenario | 驗證 |
|---|---|
| `create_channel.test.ts` | `channel.create` → on-chain Group object 存在、自己是 admin |
| `send_and_history.test.ts` | send 3 條 → history 拉回 3 條、順序正確、簽章 verified |
| `invite_and_subscribe.test.ts` | 兩把 keypair 模擬 Alice + Bob，Bob subscribe 能解密歷史 |
| `memory_roundtrip.test.ts` | write → read 內容一致；inner signature verified |
| `permission_revoke.test.ts` | kick 成員後新 key version 上、舊成員讀不到新訊息 |
| `tampered_blob.test.ts` | 手動竄改 blob → verify 必失敗 |
| `relayer_offline.test.ts` | RELAYER_URL 指 127.0.0.1:9 → 訊息進 outbox；恢復後重送 |
| `gas_insufficient.test.ts` | 空帳號 → `INSUFFICIENT_GAS` 結構化錯誤 |

**Test fixture**：每次 setup 在 testnet 開新 channel；fresh keypair 從 faucet 領 gas。

**CI**：GitHub Actions 跑 unit + 一小部分穩定 integration；完整 integration 在 PR 前手動跑。

### 8.4 E2E Test（估 1 天）

**真兩個 MCP server process**（不同 wallet config / 不同 keychain），驗 D2 完整流程跑得起來。

腳本（pseudo-code）：

```bash
# tests/e2e/d2-demo.sh
./scripts/alice-mcp.sh &
./scripts/bob-mcp.sh &

# Alice 端
mcp-call alice channel.create '{"name":"e2e-test"}' > /tmp/channel.json
CHANNEL_ID=$(jq .channel_id /tmp/channel.json)
mcp-call alice channel.send "{\"channel_id\":\"$CHANNEL_ID\",\"content\":\"hello\"}"
mcp-call alice memory.write "{\"channel_id\":\"$CHANNEL_ID\",\"key\":\"a.md\",\"content\":\"...\"}"
mcp-call alice channel.invite "{\"channel_id\":\"$CHANNEL_ID\",\"address\":\"$BOB_ADDR\"}"

# Bob 端
mcp-call bob channel.join "{\"channel_id\":\"$CHANNEL_ID\"}"
mcp-call bob channel.history "{\"channel_id\":\"$CHANNEL_ID\"}" | grep "hello"
mcp-call bob memory.read "{\"uri\":\"...\"}" | grep verified
mcp-call bob channel.send "{\"channel_id\":\"$CHANNEL_ID\",\"content\":\"bob here\"}"

# Verification
mcp-call alice identity.verify "{\"message_id\":\"$BOB_MSG_ID\"}" | grep "verified: true"
```

**通過條件**：全部 grep 過 + 沒有 stderr error。
**頻率**：每天跑一次（手動），demo 前一週每天跑。

### 8.5 Demo Rehearsals（錄影前 3 次以上）

不是傳統測試，但 hackathon 評分有 **Presentation 10%**——rehearsal 是直接賺分。

Checklist：
- [ ] 雙視窗排版 OK（左右並排、字夠大）
- [ ] 講解節奏在 5 分鐘內（精確碼錶）
- [ ] 每個 slash command 第一次跑都成功
- [ ] 三個 subagent 平行跑時不互搶輸出
- [ ] `/agent-verify` 顯示的簽章詳情清晰可見（demo 高光時刻）
- [ ] 錄影軟體不卡（用 ScreenStudio / OBS 先試錄 30 秒）
- [ ] 麥克風音量正常、無背景噪音
- [ ] 網路順（測 RPC / Walrus / Seal latency）

### 8.6 Manual Smoke Tests（每次 push 前 30 秒）

1. `npx walrus-agent-stack-mcp --health` 印健康狀態
2. `mcp-call channel.create` 成功
3. `mcp-call channel.send` + `channel.history` round-trip
4. `mcp-call memory.write` + `memory.read` round-trip

加進 `package.json` 的 `prepush` script 或 git hook。

### 8.7 不做的測試

- ❌ 100% code coverage（追求 critical path coverage）
- ❌ Property-based testing
- ❌ Load test
- ❌ Security audit（README 寫明「unaudited beta」）
- ❌ Mock 整個 sui-stack-messaging（信任既有 SDK）

### 8.8 Bug 紀錄

- 用 GitHub issues 直接記
- Label：`infra` / `crypto` / `agent` / `ux` / `demo`
- 每個 bug 帶 reproduction steps
- 不開 milestone，太重；用 issue 自帶 status 即可

---

## 9. 為什麼這個專案會在 Walrus Track 拿名次（敘事彈藥）

1. **Real-World Application 50%**：D2 直接對應 problem statement 第一段「agents lose context across sessions, struggle to share knowledge across tools, teams」——這是 Sui 文件自己寫的痛點
2. **Walrus 不可替代性**：跨組織共享 memory + 第三方可驗證，這個組合**非去中心化儲存做不到**
3. **官方背書路徑**：sui-stack-messaging 已在 Walrus track 推薦參考清單；在它之上做 multi-agent 抽象是「沿著官方鋪好的路繼續走」
4. **Distribution Hack**：Claude Code plugin marketplace = 目標 B2D 用戶天然出現的地方；hackathon 結束後 plugin 還能繼續長
5. **Mainnet-ready**：sui-stack-messaging 已 beta mainnet；上 mainnet 阻力最低 → 解鎖 100% 獎金
6. **Technical 20%**：Sui 簽章 + Seal 門檻加密 + Walrus content-addressed + sui-stack-messaging E2E 的組合，技術完整度天花板高
7. **Presentation 10%**：D2 demo 雙視窗左右並排，戲劇張力強
