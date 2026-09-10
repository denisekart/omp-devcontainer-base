# Telegram Bridge: Content & Pacing Optimizations

Status: PROPOSED (findings + design; implement after user approval)
Scope: `build/tg-bridge/{daemon.ts, lib/socket.ts, lib/render.ts, selftest.ts}` + `build/library/omp-defaults/agent/extensions/telegram-bridge.ts`

## 1. Findings (what we know now)

### Noise sources (all confirmed in code + live log)

1. **Turn-index framing** `🛫 N` / `🛬 N` emitted at every verbosity level (extension `renderProgressLine` L299-312). Useless signal → drop.
2. **Success tool one-liners** `🔧 bash && bun…` at `mid`+ (L313-318), truncated at 60 chars — the `&& bun` artifact the user saw. Errors are the only useful tool signal → keep errors only.
3. **`message is not modified` 400s** on every finalize flush (live log, ~18×): `flushMessage` re-edits identical text when the last flush already delivered everything. Cosmetic but pollutes the log and costs a round-trip → skip unchanged edits.
4. **Empty/framing-only turns** still publish a live message (`publishTurn` with only framing content) → `No live message …, publishing new` per turn (normal first-line path, but visible near-empty messages in the topic).
5. **Duplication**: two concurrent extension streams for one cwd (proven: 19:07Z log — two `hello`s, two sessionIds, same cwd) both stream progress into the same topic → whole blocks intermix/duplicate. Offset is persisted *before* processing (`handleUpdate` L669-670), so daemon-restart redelivery is NOT the cause. Daemon `hello` handler does `sessions.set` with no eviction (socket.ts L184-203), so the stale stream keeps delivering.

### Confirmed facts that shape the design

- **`message_thread_id`** is the inbound forum-topic field (routing fix already deployed, verified by user).
- **`readonlySessionManager`** cannot run `/btw`-style ephemeral turns. The harness's own one-shot completion path is `completeSimple(model, {systemPrompt, messages}, {apiKey})` from `@oh-my-pi/pi-ai`, keyed via `ModelRegistry.getApiKey(model)` (mirrors internal `__completion__` bridge).
- **Bare `@oh-my-pi/*` imports are host-resolved**: the extension loader rewrites every `@oh-my-pi/*` specifier to an absolute `file://` URL (`legacy-pi-compat.ts` `rewriteLegacyExtensionSource`). `import("@oh-my-pi/pi-ai")` needs no local `node_modules`.
- **Events available** for "important points": `turn_start/end`, `message_end` (`message` = AgentMessage union), `tool_execution_end` (`isError`, `result`), `todo_reminder` (`todos: TodoItem[]`), `tool_approval_requested`, `agent_start/end`.
- `sendChatAction(chatId, "typing")` already exists in `lib/telegram.ts`. Telegram typing indicator expires ~5 s → needs ~4 s refresh while a turn is live.

## 2. Design

### 2.1 Verbosity matrix (extension `renderProgressLine`)

Target: **`mid` = important points only**. User prefers to ask for updates mid-task.

| kind | low | mid (new default) | high |
| --- | --- | --- | --- |
| turn_start / turn_end | – | – (framing dropped; turn boundary still drives daemon typing/finalize) | – |
| tool success | – | – | one-liner (existing) |
| tool error | `⚠️ <tool>` | `⚠️ <tool>: <first line of error, ≤200 chars>` | same + result excerpt |
| assistant message | – | final answer only (see 2.2) | every assistant message |
| user message (steering) | – | – | `👤 <text>` (provenance, `high` only) |
| todo reminder | – | – | todo list (existing) |
| periodic summary | – | ✅ (see 2.3) | ✅ + todos appended |
| error (non-tool) | – | ✅ | ✅ |

`xhigh` = everything (debugging). `low` unchanged except framing dropped.

**Turn-boundary frames still go over the wire** (daemon needs them for typing + live-message lifecycle) — the extension just stops *rendering* them into content at all levels.

### 2.2 Assistant messages at `mid`

`message_end` fires per assistant message; long turns interleave tool calls, so a naive "send every assistant text" is chatty. Rule:

- Extension batches assistant text as today; at `mid`, only **the text of the last assistant message of the turn** is delivered (flush-on-`turn_end` already coalesces; mark prior assistant texts as stale in the batch on `turn_start`).
- Rich formatting kept/improved: ```` ``` ```` fences → `<pre><code>`, `` `code` ``, `**bold**`; add `*emphasis*` → `<i>`.

### 2.3 Periodic summary (the `/btw` item)

Cadence: every **8 turns** (configurable via `config.json` `summaryEvery`, default 8) while a turn is active; plus once at `turn_end` of a long turn (≥6 tool calls) if no summary fired yet this turn.

Content pipeline (extension side, ~60 lines):

1. Maintain an in-turn event digest: tool names, error excerpts, todo transitions, assistant text deltas (already all available in handlers).
2. On fire:
   - `try { const { completeSimple } = await import("@oh-my-pi/pi-ai") } catch → fallback`.
   - AI path: `completeSimple(ctx.model, { systemPrompt: ["Summarize this coding session progress in 2-4 short lines: what's done, what's in flight, blockers."], messages: [user: digest] }, { apiKey: await ctx.modelRegistry.getApiKey(ctx.model) })` — no tools, no session, no history mutation. ~1–3 s.
   - Fallback (or any error/timeout 15 s): deterministic digest — "In flight: X, Y · N tools, M errors · last error: …".
3. Send as a standalone message (not into the live turn message) with a `📊` prefix. One log line: `[btw] ai` / `[btw] digest`.

Risk containment: lazy dynamic import inside a `ctx.setTimeout`-driven async callback, fully try/caught — a resolution failure degrades to digest, never kills the extension. First live check = read `daemon.log`/extension log after first summary (trial-and-error collaboration point).

### 2.4 Empty-message suppression (extension + render)

- Extension: `flushProgressBatch` sends nothing when all rendered lines are empty (already `renderProgressLine` returns null → nothing queued; guard `flushProgressBatch` on `lines.length === 0` after filtering).
- Render: `publishTurn`/`addLine` — if accumulated text is whitespace-only, don't create a Telegram message; defer until real content arrives (`addLine` returns without publishing when `msg.lines.join("\n").trim() === ""`).

### 2.5 Unchanged-text edit skip (render)

`flushMessage`: track `lastSentText` per live message; skip `editMessageText` (and the overflow edits) when `text === lastSentText`. Kills the 400 spam.

### 2.6 Per-cwd session eviction (socket.ts `hello`)

Contract: **single connected session per cwd; new session evicts the old one.**

```
case "hello":
  existing = sessions.get(cwd)
  if (existing && existing.stream && existing.stream !== socket) {
    log(`evicting stale session for ${cwd} (old ${existing.sessionId}, new ${sessionId})`)
    existing.stream.destroy()
  }
  sessions.set(cwd, state)
```

- Different cwds coexist (one workspace = one topic; user uses one topic).
- Stale-close path verified safe: `close` only deletes `session.stream === socket`, so an evicted stream's late close won't delete the new session's state.
- Selftest property: two sockets, two hellos same cwd → first stream destroyed, second keeps receiving frames; second cwd unaffected.

### 2.7 Typing indicator (daemon)

While `session.turnLive` for a bound cwd with `remoteOn`: `sendChatAction(groupId, "typing")` every **4 s** (timer on the daemon; cleared on `turn_end`/`bye`/session gone). Bound to the topic via `message_thread_id` — needs `sendChatAction(chatId, action, threadId?)` overload in `lib/telegram.ts` (tiny).
Cap: don't start typing for a turn that already emitted a question frame (user has something to do).

### 2.8 Ack phrasing (daemon, minor)

Keep the ack (user wants confirmation the message landed) but plain:

- `📨 Received — starting a new turn` → `Got it — starting on it.`
- `📨 Received — steering the running turn` → `Got it — steering the running turn.`
No emoji spam; rest of daemon copy unchanged.

### 2.9 `/status` enrichment (daemon)

Current `status_request` → `daemon_status {sessions, activeSessions}`. Add per-bound-cwd block in the `/status` command reply:

- turn live/idle + last event age (from `SessionState.turnLive`/`lastEventAt`)
- current todos: new progress kind `todo_state` emitted by extension on `todo_reminder` (daemon stores latest per cwd; include top 5 items in `/status`).
- `/status` still works when no session is connected (shows bindings + last-known state).

### 2.10 Human tone

Minimal: acks + summary wording only. No emoji on progress lines beyond `⚠️` (error) and `📊` (summary). No new emoji elsewhere.

## 3. Selftest properties (new, all must fail on old code)

1. **t_evictStaleSession**: two sockets → same-cwd hellos → old stream's `write` destroyed/closed (assert via close event or `sendFrame` to old cwd going to new stream), second-cwd session intact.
2. **t_noDuplicateFramesPerCwd**: after eviction, progress frames from the evicted stream are not forwarded (session map no longer references it).
3. **t_skipUnchangedEdit**: two identical `addLine` flushes → one `editMessageText` call in `getCalls()`; text-unchanged finalize → zero extra edits, no 400.
4. **t_emptyTurnPublishesNothing**: turn with only empty lines → `sendMessage` call count 0 until real content arrives.
5. Existing 15 tests stay green (routing, turn isolation, replay, pairing).

## 4. Non-goals

- No multi-topic multiplexing (user uses one topic).
- No media/voice. No editing of question keyboard buttons.
- No `runEphemeralTurn` (unreachable from extensions — documented).
- No new config surface beyond `summaryEvery` (optional; default 8).

## 5. Rollout

1. Implement (single implementer — files are coupled through the socket frame contract).
2. Gate (all 6): `tsc --noEmit -p build/tg-bridge/tsconfig.json`; `tsc --noEmit -p tsconfig.bridge.json`; `bun selftest.ts` (18 tests); `bash -n supervisor.sh`; `bash -n sync-omp-defaults.sh`; `sync-omp-defaults.sh --check` (only `config.yml` differs).
3. Deploy: mirror `daemon.ts,selftest.ts,node.d.ts,supervisor.sh` + `lib/{bindings,render,socket,telegram}.ts` → `/usr/local/share/tg-bridge/`; extension via `sync-omp-defaults.sh` (config.yml backup/restore). Restart daemon (supervisor respawns). User restarts omp session.
4. Live verify in topic 68: send a prompt that runs ~6 tools → observe: no dup blocks, no empty messages, no 400 spam in `daemon.log`, typing indicator, `⚠️` only on real errors, `📊` summary at turn 8, `/status` shows todos + turn state. Check `[btw] ai|digest` log line (the trial-and-error checkpoint).
