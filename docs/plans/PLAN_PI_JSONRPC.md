---
state: approved
needed: true
reviewed: 2026-06-06
notes: 'Draft 2026-06-06 after a successful live experiment against the local `pi` binary and a reviewer-subagent pass. See ../TODO.md for the active step list once approved.'
---

# Plan: Switch the research subagent to JSON-RPC for live feedback

## Context

<goal syntax="markdown">Replace the `pi -p "<prompt>"` print-mode spawn in `extensions/pi-agent.ts` with a JSON-RPC connection (`pi --mode rpc`) so the parent can stream the subagent's text deltas, tool calls, and progress events in real time. The external `spawnPiAgent(...)` API stays source-compatible (same options, same `SpawnPiAgentResult` shape, same `onChunk` callback); the internal transport changes from a buffered stdout drain to a typed event stream. The byte-identical fallback content on the agent-error path is preserved; the resume-session contract from `docs/plans/PLAN_AGENT_ERROR_RESUME.md` is preserved.</goal>

The research subagent today is spawned with `pi -p "<prompt>" …` and the parent collects the entire stdout at process exit. That gives no live feedback: the user sees "🧠 Analyzing content…" in the TUI for 10–60s, then a single big chunk dumps in. Internally, the LLM is streaming, the subagent is calling `read` / `grep` / `bash` tools, and a lot of work is happening — but the parent is blind to it.

`pi` ships a stable JSON-RPC mode (`--mode rpc`) over JSONL on stdin/stdout (see `~/.pi/docs/rpc.md` in the runtime, mirrored at `node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`). The same package exports a typed `RpcClient` class that:

- spawns `pi --mode rpc` (or `node <cliPath> --mode rpc`),
- pumps a strict-JSONL reader on stdout (LF-only, not Node `readline` — important so U+2028 / U+2029 inside prompt text don't split records),
- parses command responses and event payloads,
- and exposes `prompt`, `steer`, `followUp`, `abort`, `getState`, `getMessages`, `getLastAssistantText`, `waitForIdle`, `collectEvents`, and an `onEvent(listener)` subscription.

The events we care about:

- `message_update` with `assistantMessageEvent.type === "text_delta"` → live text deltas, the primary "chunk" source.
- `message_update` with `assistantMessageEvent.type === "thinking_delta"` → optional, surfaced as a "🧠 thinking…" status if we want it.
- `tool_execution_start` / `tool_execution_end` → the subagent calling `read`, `grep`, `bash`, etc. We can surface "📖 reading input.md", "🔍 grep …", "🔧 bash ls" in the TUI status.
- `extension_ui_request` (the subagent's own extensions calling UI methods) → we auto-dismiss so the subagent can never block the parent.
- `agent_end` → the run is finished; we collect the final assistant text and resolve.

The experiment at `/tmp/rpc-experiment*.mjs` (run during plan authoring, then deleted) confirmed:

- `pi --mode rpc` boots in ~100ms cold, ~6s warm (model + provider init), then text deltas arrive at LLM-streaming speed.
- `--name`, `--session-id`, `--no-extensions`, `--tools` (allowlist), `--skill` (cwd-relative paths) all pass through `args[]` on `RpcClientOptions` and land in the subagent's argv unchanged.
- `getState()` returns the exact `sessionId` / `sessionName` the subagent adopted (we can echo it back on the result, not just the pre-computed id).
- The local `pi` binary at `/opt/homebrew/bin/pi` is a symlink to `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`; the `RpcClient` defaults to `spawn("node", [cliPath, ...args])` which works, but we should override to spawn `pi` directly so we don't pay the `node` cold-start cost on every research call.

This plan pivots the `spawnPiAgent` transport, not the contract.

## Scope

### In scope

- **New `extensions/pi-rpc-client.ts`** — a thin wrapper that drives the JSON-RPC protocol directly, *not* a subclass of `RpcClient`. The wrapper:
  - spawns the local `pi` binary (resolved via the existing `findPiExecutable` pattern, defaulting to `'pi'`) with `--mode rpc` and the existing `--name` / `--session-id` / `--tools` / `--skill` / `--no-extensions` / `-e` argv.
  - inherits `cwd` / `env` from `SpawnPiAgentOptions`.
  - uses `attachJsonlLineReader` and `serializeJsonLine` from `@mariozechner/pi-coding-agent/dist/modes/rpc/jsonl.js` for the strict-JSONL framing (we don't reinvent the LF-only split; see `docs/plans/PI_RPC_NOTES.md` for the why).
  - implements minimal request/response correlation on top (one pending command at a time — the research subagent is single-turn).
  - exposes a small event-driven API: `on('text', chunk => ...)`, `on('tool', { phase, name, args } => ...)`, `on('thinking', chunk => ...)`, plus `run({ prompt, signal, timeoutMs })` returning `{ text, sessionId, sessionName, exitCode, error? }`.
  - auto-dismisses `extension_ui_request` events (cancel dialogs, silence notify/setStatus/setTitle) so the subagent can never block on UI.
  - surfaces the actual `sessionId` / `sessionName` from `getState()` on completion, not just the pre-computed id.

  **Why a custom wrapper, not a subclass of `RpcClient`?** (Reviewer feedback.) The official `RpcClient` is well-engineered for multi-command interactive use, but it has hard-coded assumptions that don't fit the research-subagent shape:
  - `RpcClient.start()` does `spawn("node", [cliPath, ...args])` with no factory hook. To use it with the local `pi` binary directly (no `node` cold-start), we'd either subclass and re-implement `start()` (~30 lines of process setup we don't want to maintain against upstream) or monkey-patch the prototype (fragile across `npm install`).
  - `RpcClient.send()` has a 30-second hard-coded per-command timeout on `pendingRequests.get(id)`. The research-subagent timeout is configurable (default 180s) and we want the *whole run* to time out, not individual commands. Layering our own timeout on top means we race with the upstream 30s.
  - `RpcClient.handleLine()` is tightly coupled to the `eventListeners` + `pendingRequests` model. We need to intercept `extension_ui_request` events at the dispatch layer (to auto-cancel dialogs) — that interception is awkward in the public `onEvent` API but trivial inside our own `handleLine`.
  - We only consume ~5 event types (`message_update`, `tool_execution_*`, `extension_ui_request`, `agent_end`, `getState` response). The full `RpcClient` API surface (steer, followUp, fork, clone, switchSession, bash, etc.) is dead weight for our use case.
  - The protocol is stable; a 50-line transport is not at risk of drifting from `RpcClient`'s implementation, only from the protocol itself. The protocol is the API contract, not the class.

  The 50-line wrapper reuses `attachJsonlLineReader` and `serializeJsonLine` (the only protocol-aware parts) and reimplements the trivial bits (spawn, request id, response wait, event fanout). This is the same trade-off the official examples in `docs/rpc.md` make.
- **Refactor `extensions/pi-agent.ts::spawnPiAgent`** to use `pi-rpc-client` internally:
  - same options (`onChunk`, `onToolCall`, `timeout`, `sessionId`, `sessionName`, `url`, `inputFile`, `inputRawFile`, `cwd`, `env`, `skills`, `extensions`, `noExtensions`),
  - same `SpawnPiAgentResult` (`analysis`, `exitCode`, `sessionId`, `sessionName`),
  - `onChunk(chunk)` now fires for every `message_update` text delta from the subagent (was: every stdout chunk from `-p` mode).
  - `onToolCall({ phase, name, args })` is a **new optional callback** (additive, defaults to no-op) — fires for `tool_execution_start` / `tool_execution_end`. The parent can map it to "📖 reading input.md" / "🔧 bash ls" status strings in `webfetchResearch`.
  - process-level error handling unchanged: timeout → `PiAgentError('Pi agent timed out after Xms', null)`, spawn error → `PiAgentError('Failed to spawn pi: …', null)`, exit non-zero → `PiAgentError(stderr || '…', code, stderr)`.
- **Extend `extensions/services/research-service.ts`** to thread a new `onToolCall` through to `spawnPiAgent`. Map the tool events to a friendly phase label in the streaming callback:
  - `read` / `grep` / `find` / `ls` (the lean research tools) → `phase: 'reading'`
  - `bash` → `phase: 'executing'`
  - default → `phase: 'thinking'`
  The status string the parent sees is something like `📖 reading input.md` or `🔧 bash: ls /tmp/pi-webfetch-research/abc123`.

  **Type-system note (reviewer feedback, important).** `FetchPhase` (in `extensions/fetch-phases.ts`) currently only knows `idle | starting | detecting-provider | fetching | processing | analyzing | streaming | complete | error`, and `WebfetchDetails.phase: FetchPhase`. The new phases `reading` and `executing` are *not* in the enum today. The plan adds them to the `FetchPhase` union and to both label maps (`FETCH_PHASE_LABELS` in `fetch-phases.ts` and the inline map in `getCommandPhaseLabel`):
  - `'reading'` → `'📖 Reading input…'` / `'📖 Reading input…'`
  - `'executing'` → `'🔧 Running command…'` / `'🔧 Running command…'`
  - `'thinking'` → not surfaced as a `FetchPhase` value — it lives only on the new `onToolCall` callback and is not threaded through `WebfetchDetails.phase` (a tool we don't recognise is a subagent-internal concern, not a parent-visible phase). This keeps `FetchPhase` to a small, parent-visible set.

  The plan's streaming callback builds the `phase: 'reading' | 'executing'` `FetchPhase` value *and* a human-readable content string from the same tool event:
  - `read` tool → `phase: 'reading'`, content: `'📖 reading <path>'` (e.g. `📖 reading input.md`).
  - `bash` tool → `phase: 'executing'`, content: `'🔧 bash: <command>'` (truncated to ~60 chars).
  The content string is the user's only signal of *which* tool is running; the phase is the structural hook for tests and for downstream renderers.
- **Same-shape `WebfetchDetails`** — no new fields. The `subagentSessionId` / `subagentSessionName` from `getState()` lands on the result, but the *fields* on the details are unchanged. The byte-identical `## Fetch Result (Agent Error)` fallback from `PLAN_AGENT_ERROR_RESUME.md` is preserved.
- **New `test/helpers/fake-pi-rpc.ts`** — a `FakePiRpc` class that mimics the wrapper's event API: `on('text', cb)`, `on('tool', cb)`, `run({ prompt, … })` returns `{ text, sessionId, sessionName, exitCode }`. The fake lets us drive the test surface without spawning a real `pi` subprocess. Same pattern as `test/helpers/fake-pi-process.ts`.
- **New `test/pi-rpc-client.test.ts`** — small unit test for the wrapper that uses a mock child-process to verify:
  - the argv that lands on the subagent contains `--mode rpc` and the existing `--name` / `--session-id` / `--tools` / `--skill` / `--no-extensions` flags,
  - a `message_update` `text_delta` event reaches the `onChunk` callback,
  - a `tool_execution_start` event reaches the `onToolCall` callback,
  - `agent_end` resolves the run with the text from `getLastAssistantText()`,
  - timeout fires `PiAgentError('Pi agent timed out after Xms')`,
  - the subagent exiting non-zero rejects with `PiAgentError`.
- **Extend `test/pi-agent.test.ts`**:
  - update the existing "streaming" expectations to assert that `onChunk` fires for `text_delta` events from the fake (not stdout chunks),
  - add a new test: `onToolCall` is invoked with `{ phase: 'reading' | 'executing', name, args }` for subagent tool calls,
  - keep all existing tests for argv shape, timeout, exit-code, session flags green.
- **Extend `test/webfetch-research.test.ts`** (1–2 small cases):
  - when the subagent invokes `read` then `bash`, the streamed `onUpdate` calls reflect the tool events (a `phase: 'reading'` update and a `phase: 'executing'` update), and the final `phase: 'complete'` update is unchanged,
  - the success-path `details.subagentSessionId` is the id returned by `getState()` (which the fake fills in), not the pre-computed one.
- **New docs**:
  - one short `docs/plans/PI_RPC_NOTES.md` (matching the existing `docs/plans/PLAN_*.md` convention) summarizing the protocol quirks that bit us during the experiment (LF-only framing, `extension_ui_request` auto-dismiss, default `node`-spawn override, etc.) — for the next person to touch this code,
  - update `AGENTS.md` "Architecture Notes" with one paragraph on the JSON-RPC transport and the new `onToolCall` callback,
  - update `README.md` "Configuration" / "Behavior" section to mention that progress is now live (no behavior change for callers, just a UX note),
  - add a `CHANGELOG.md` entry under "Changed" describing the transport switch.
- **Manual smoke** — from a real pi session, run `/webfetch <url> "summarize"` against a moderately large page. Observe: `🧠 Analyzing content…` → `📖 reading input.md` → `🔍 grep …` → text deltas arrive in chunks → final result. No regression in the byte-identical fallback or the resume-command notify on a forced failure.

### Out of scope (deferred)

- **A `-p` print-mode fallback inside `spawnPiAgent`.** This plan drops `-p` outright. There is no second transport inside `spawnPiAgent`, no feature flag, no opt-in to the old behavior. The MVP is JSON-RPC, full stop. If the JSON-RPC mode ever breaks on a specific `pi` version, the fix is in the wrapper, not in a runtime fallback. This keeps the transport surface small, the tests simple (one path to mock), and the behavior predictable across extension / CLI / MCP.
- **Steering / follow-up messages** from the parent into the subagent. We send one prompt and collect the result. If the user wants multi-turn research (a true "session" the subagent can come back to), that's a follow-up plan that builds on the persistent-session groundwork from `PLAN_AGENT_ERROR_RESUME.md`.
- **Cross-version compatibility tests.** The experiment used `pi` 0.78.1 (homebrew) and `@mariozechner/pi-coding-agent` 0.70.6 (the one in `node_modules`). The JSON-RPC protocol is version-stable (the 0.70.6 `RpcClient` is in the same `dist/modes/rpc/rpc-client.{d.ts,js}` shape as the 0.78.1 runtime's docs describe). We don't pin versions in the plan; we rely on the existing peer-dependency range (`"*"`).
- **A pid-isolated spawn** (process group / `detached: true` / `killProcessTree`). The current `spawn` already runs the subagent in its own process group via `node:child_process` defaults; `proc.kill('SIGTERM')` is enough for the timeout path. The sandbox PRD's process-group concerns are still deferred.
- **Auto-resume flows, stderr→log persistence, subagent→parent extensions.** The user can still `pi --session <id>` into a failed transcript; that's the existing resume flow.
- **Multi-prompt orchestration** (e.g., "fetch → analyze → fetch another URL based on the analysis"). That's a separate orchestration layer and not part of the research-mode flow.

## Acceptance Criteria

- [ ] `spawnPiAgent` from `extensions/pi-agent.ts` is backed by the JSON-RPC client wrapper. No more `pi -p "<prompt>"` print-mode spawn — `-p` is removed from the codebase, not just unused. There is no `-p` codepath left to test or maintain.
- [ ] The argv passed to the subagent no longer contains `-p`; in its place `--mode rpc`. The existing `--name`, `--session-id`, `--tools`, `--skill`, `-e`, `--no-extensions` flags are unchanged.
- [ ] `spawnPiAgent(..., { onChunk })` fires `onChunk(delta)` for every (debounced) `message_update` `text_delta` event from the subagent. The coalesce window is bounded to ~16ms; tool-start events flush the buffer immediately; `agent_end` flushes the final text. The final `SpawnPiAgentResult.analysis` is byte-equal to the concatenation of all `onChunk` payloads.
- [ ] `spawnPiAgent(..., { onToolCall })` fires `onToolCall({ phase, name, args })` for every `tool_execution_start` event. `phase` is `'reading'` for `read`/`grep`/`find`/`ls`, `'executing'` for `bash`, `'thinking'` otherwise. The callback is **optional** (defaults to no-op) — back-compat with existing call sites.
- [ ] `SpawnPiAgentResult.sessionId` and `.sessionName` are the values returned by `getState()` on the live subagent, not just the pre-computed id. (The pre-computed id is still passed via `--session-id` for resumability — the live one is the source of truth on the result.)
- [ ] `spawnPiAgent(..., { timeout: 30_000 })` rejects with `PiAgentError('Pi agent timed out after 30000ms', null)` if the subagent does not emit `agent_end` in time. The single timeout path is the wrapper's own `agent_end` waiter racing `setTimeout(timeout)`; the wrapper then calls `client.stop()` (SIGTERM, then SIGKILL) and the parent sees the same `PiAgentError` it would have seen for a print-mode timeout. A `timeout: 300_000` does *not* trip the upstream 30s per-command limit (the wrapper owns the timer).
- [ ] `webfetchResearch` threads `onToolCall` through to `spawnPiAgent` and maps the events to streaming updates with `phase: 'reading' | 'executing' | 'thinking'`. The TUI / CLI / MCP surfaces see richer progress in the streaming config callback. The new `FetchPhase` values (`'reading'`, `'executing'`) are added to `extensions/fetch-phases.ts` (the union, `FETCH_PHASE_LABELS`, and `getCommandPhaseLabel`'s inline map) with friendly labels (`'📖 Reading input…'` / `'🔧 Running command…'`).
- [ ] The `## Fetch Result (Agent Error)` fallback content on the agent-error path is **byte-identical** to the pre-change baseline (preserved regression from `PLAN_AGENT_ERROR_RESUME.md`). The test asserts the **full body** (header + agent error line + separator + content) as a single string against a fixture or a snapshot, *not* a `startsWith` / `contains` check. (Reviewer found the current assertion in `test/webfetch-research.test.ts:85-113` is partial — the plan upgrades it to byte-equality.)
- [ ] `WebfetchDetails` is unchanged. The `notify`, `subagentSessionId`, `subagentSessionName`, `resumeCommand` fields from the prior plan still work.
- [ ] `npm run validate` is green (typecheck + lint + tests).
- [ ] No `TODO` / `FIXME` / debug code left behind.

## First Verifiable State

**Order first, not time.**

- [ ] **First task**: write `extensions/pi-rpc-client.ts` (the thin JSON-RPC transport wrapper, *not* a subclass of `RpcClient`) and `test/pi-rpc-client.test.ts` (unit tests with a mocked child-process or a `FakePiRpc` driving the event surface). Verify: `npm test -- --run test/pi-rpc-client.test.ts` green. **This is the smallest end-to-end proof: the JSON-RPC client wrapper is real, the event API is real, and a unit test exercises the streaming path without spawning `pi`.**
- [ ] **Second task**: refactor `extensions/pi-agent.ts::spawnPiAgent` to use `pi-rpc-client` internally. Extend `test/pi-agent.test.ts` to assert `onChunk` fires for `text_delta` and `onToolCall` is invoked for tool events. Verify: `npm test -- --run test/pi-agent.test.ts` green. **The public `spawnPiAgent` API is unchanged; existing call sites in `webfetchResearch` / CLI / MCP keep working.** The `-p` print-mode path is removed from `pi-agent.ts` (no comment about "back-compat", no fallback branch, no test for it).
- [ ] **Third task**: thread `onToolCall` through `webfetchResearch` to surface `phase: 'reading' | 'executing' | 'thinking'` in the streaming config. Extend `test/webfetch-research.test.ts`. Verify: `npm test -- --run test/webfetch-research.test.ts` green. **The UX win is real: live tool progress in the TUI / CLI / MCP.**

Once those three green, the rest of the plan is mechanical: docs, `CHANGELOG`, manual smoke, and the validate gate.

## Implementation Notes

### Tech decisions

- **Use a custom 50-line wrapper, not a subclass of `RpcClient`.** See the "Why a custom wrapper, not a subclass of `RpcClient`?" block in *Scope → In scope → `extensions/pi-rpc-client.ts`*. The trade-off: we lose `RpcClient`'s full API surface (steer, followUp, fork, clone, switchSession, bash, etc.) and its `waitForIdle` helper, but we gain direct control over the spawn (no `node` cold-start), the per-command timeout (we own the timer), the `extension_ui_request` interception (we own the dispatch), and the event-API shape (one `onText` / `onTool` / `onThinking` per run, not the full `onEvent` fanout). We reuse `attachJsonlLineReader` and `serializeJsonLine` from `@mariozechner/pi-coding-agent/dist/modes/rpc/jsonl.js` (the only protocol-aware helpers we need).
- **Spawn `pi` directly, not `node dist/cli.js`.** The `findPiExecutable()` helper already returns `'pi'`. The wrapper resolves it via `process.env.PATH` at spawn time. If the user has a custom `pi` location (e.g., a dev build), they can set `PATH` accordingly. The wrapper accepts an explicit `piPath` option for tests.
- **`onChunk` semantics change: from "stdout chunk" to "text delta".** This is a behavior change for any caller that was relying on the exact chunk boundaries from `-p` mode. In practice, the only caller is `webfetchResearch`, and it treats `onChunk` as "more text to append to the streamed output", which is exactly what text deltas are. The test surface pins this. If a future caller wants the full final string in one shot, they can use `getLastAssistantText()` or the new `result.analysis` (which is still the full concatenated text). Because we are dropping `-p` outright, there is no "old behavior" to preserve — the chunk contract is *just* the new one.

- **`onChunk` debouncing is required** (reviewer feedback, important). Text deltas from `message_update` arrive at LLM-streaming frequency — a few characters at a time, potentially hundreds of events per second for a fast model. The current `-p` mode produced a handful of large stdout chunks per process. The parent (`webfetchResearch`'s streaming callback in `extensions/services/research-service.ts:221-226`) forwards every `onChunk` directly to `config.callback`, which ends up in the pi TUI's `onUpdate` path — that path re-renders on every call. Undebounced, this is render thrash.

  **Mitigation:** the wrapper (or `spawnPiAgent`) coalesces text deltas in a small buffer and flushes on a ~16ms cadence (one animation frame). The buffer is flushed immediately on `tool_execution_start` (so the user sees the tool call right after the text leading up to it) and on `agent_end` (so the final text is never lost). The total text the caller sees is byte-equal to the concatenation of all deltas — the coalescing is invisible to the consumer. The test surface pins: (a) the final `onChunk` payload equals the concatenation of all deltas, (b) tool-start events flush the pending text, (c) the maximum buffer dwell time is bounded.

  The 16ms cadence is the standard "one frame at 60fps" budget. It's the same coalescing pattern pi's own TUI uses for the same event stream.

- **`onToolCall` is added at the `SpawnPiAgentOptions` level** (not internal to `webfetchResearch`). This keeps the wrapper surface coherent (one event API: `onChunk` for text, `onToolCall` for tools) and lets future call sites (e.g., a hypothetical `webfetchResearchMulti` orchestrator) reuse the same primitive. The cost is a 30-line addition to `SpawnPiAgentOptions`; the benefit is a single, consistent event API. Reviewer suggested making it internal-only; we accept the small API growth for the API-consistency benefit. The callback is **optional** and defaults to no-op, so existing call sites are unaffected.

- **The `node_modules` vs homebrew version mismatch is real** (`@mariozechner/pi-coding-agent@0.70.6` in `node_modules`; `@earendil-works/pi-coding-agent@0.78.1` at `/opt/homebrew/bin/pi`). The JSON-RPC protocol is the same shape across both — the `RpcClient` class even has the same public methods. We import `attachJsonlLineReader` and `serializeJsonLine` from the package; we do not instantiate `RpcClient` (it would default to `node` and a different cli path). The 50-line wrapper reuses those two helpers and spawns `pi` directly. The plan no longer carries a `-p` fallback, so we don't have to worry about the two transports disagreeing on what the subagent "should" do — there is exactly one.

- **Auto-dismiss `extension_ui_request` is the *unconditional* default for research subagents, with a documented opt-out for user-supplied extensions.** Reviewer flagged that auto-dismissing dialogs could mask legitimate interactive workflows if the user passes `-e /path/to/extension.ts` that calls `ctx.ui.confirm(...)`. The wrapper accepts an `autoDismissUiRequests` option (default `true`); when set to `false`, the wrapper leaves `extension_ui_request` events for the parent to handle. The `SpawnPiAgentOptions` does *not* surface this knob (the research subagent is non-interactive by design), but the wrapper option is there for tests and for any future caller that wants a different policy. `webfetchResearch` always uses the default (`true`). The plan documents this in `docs/plans/PI_RPC_NOTES.md` under "Auto-dismiss policy".

- **Timeout strategy is single-path.** The wrapper owns the `agent_end` waiter (a single `setTimeout(timeoutMs)`) and a `client.stop()` cascade (SIGTERM, then SIGKILL after 1s). We do *not* use the upstream `RpcClient.waitForIdle` (we don't have a `RpcClient`). We do *not* inherit the upstream 30s per-command timeout (we don't use the upstream `send`). The parent sees exactly one error shape on timeout: `PiAgentError('Pi agent timed out after ${timeoutMs}ms', null)`. The abort/SIGTERM/SIGKILL race is single-state-machine: `run()` either resolves with the final result or rejects with a `PiAgentError`; it never does both (see *Risks* for the full reasoning).

- **JSONL framing: LF-only.** The package's `attachJsonlLineReader` does this correctly (no `node:readline`, no Unicode-separator split). The plan uses that helper, not a hand-rolled `readline.createInterface`. This is a documented gotcha; `docs/plans/PI_RPC_NOTES.md` calls it out so the next person doesn't break it.

- **No `cwd` change for the subagent.** It inherits the parent's cwd, same as today. This is required for the existing `pi --session <id>` resume flow (cwd-scoped session lookup).

- **The `getState()` round-trip is the source of truth on the result.** The pre-computed `sessionId` (from `deriveSessionId`) is what we pass via `--session-id` (for resumability + for the agent-error resume hint). But the subagent might adopt a slightly different id (e.g., the runtime appends a suffix, or our hash collides). On success, we call `client.getState()` and use the *live* `sessionId` / `sessionName` for `SpawnPiAgentResult`. On the agent-error path, we keep the pre-computed ids (the subagent may not have responded to `getState()`).

- **`onToolCall` event mapping is opinionated but minimal.** We map tool name → phase in the wrapper; the research service just trusts the phase. If a new tool is added to the lean set (`read`, `grep`, `find`, `ls`, `bash`), the default is `'thinking'`, which is safe.

- **The skill path resolution bug is fixed in this plan as a small additive change** (reviewer flagged it as a separate concern; we bundle it because the new wrapper touches the same argv-construction code). The current `resolveSkillPaths` (`extensions/pi-agent.ts:160-165`) only checks `skillPath.includes(skill)` (always true) and pushes a non-existent path. We replace it with a real `fs.existsSync` check. Behavior: only existing skill dirs are added to argv; non-existent ones are silently dropped (with a debug-level log in tests). The lean default skills (`agent-browser`, `planning`) all exist on the dev machine, so this is a correctness fix with no observable behavior change for the happy path.

### Key files

| Path | Change |
|---|---|
| `extensions/pi-rpc-client.ts` | NEW: ~50-line wrapper that spawns `pi --mode rpc` directly, uses `attachJsonlLineReader` from the package, exposes a small event-driven API, auto-dismisses `extension_ui_request`. |
| `extensions/pi-agent.ts` | Replace the print-mode `spawn` with a call to `pi-rpc-client`. New optional `onToolCall` on `SpawnPiAgentOptions`. Keep `onChunk`, `timeout`, `sessionId` / `sessionName` unchanged. Update the JSDoc to describe the new transport. **Delete the `-p` argv building, the stdout drain, the print-mode timeout, and the print-mode `PiAgentError` paths** — none of them exist in the new code. |
| `extensions/services/research-service.ts` | Thread `onToolCall` through to `spawnPiAgent`. Map the events to streaming updates with `phase: 'reading' | 'executing' | 'thinking'`. Update the `sendStreamingUpdate` to accept a phase string. |
| `test/helpers/fake-pi-rpc.ts` | NEW: `FakePiRpc` event-emitter with the same surface as `pi-rpc-client` (no real subprocess). Mirrors `test/helpers/fake-pi-process.ts`. |
| `test/pi-rpc-client.test.ts` | NEW: unit tests for the wrapper. Uses a mocked child-process to assert argv and the event path. |
| `test/pi-agent.test.ts` | EXTENDED: rewrite the existing fake-process tests (`fakePiSuccess`, `fakePiError`, `fakePiSlow`) to use the new `FakePiRpc` surface. Add a test for `onToolCall`. **Delete tests that assert on stdout chunks or `-p` argv — they no longer model real behavior.** |
| `test/webfetch-research.test.ts` | EXTENDED: assert that subagent tool calls show up as `phase: 'reading' | 'executing'` streaming updates. |
| `docs/plans/PI_RPC_NOTES.md` | NEW: protocol quirks (LF-only framing, `extension_ui_request` auto-dismiss, default `node`-spawn override, `getState` as source of truth, etc.) for the next maintainer. Lives next to the plan in `docs/plans/` to match existing convention (no new `docs/notes/` directory). |
| `CHANGELOG.md` | NEW entry under "Changed". |
| `README.md` | One paragraph on live feedback (no behavior change for callers). |
| `AGENTS.md` | One paragraph in "Architecture Notes" on the JSON-RPC transport and the `onToolCall` callback. |
| `docs/plans/PLAN_AGENT_ERROR_RESUME.md` | Add a one-line cross-reference under "Architecture Notes" / "Implementation Notes" pointing at this plan. |

### Tests needed

- `test/pi-rpc-client.test.ts` — new file, ~10 cases:
  1. `pi --mode rpc` is spawned with the right argv (including `--name`, `--session-id`, `--tools`, `--skill`, `--no-extensions`).
  2. A `message_update` event with `assistantMessageEvent.type === "text_delta"` fires the `onText` callback with the delta.
  3. A `tool_execution_start` event fires `onTool` with `{ phase, name, args }`. Phase mapping is correct: `read` → `'reading'`, `bash` → `'executing'`, default → `'thinking'`.
  4. `agent_end` resolves `run({ prompt })` with `{ text, sessionId, sessionName, exitCode: 0 }`. `text` is from `getLastAssistantText()`.
  5. An `extension_ui_request` with `method: "notify"` is dropped (no stdin write).
  6. An `extension_ui_request` with `method: "confirm"` is answered with `{ type: "extension_ui_response", id, cancelled: true }`.
  7. Timeout (no `agent_end` in time) rejects with `PiAgentError('Pi agent timed out after Xms')` and the child process is killed.
  8. The child process exiting with a non-zero code rejects with `PiAgentError(stderr || 'pi exited with code N', N, stderr)`.
  9. `onText` debouncing: with a 16ms coalesce window, 100 rapid `text_delta` events produce at most a small handful of `onText` calls (≤ 10); the concatenated `text` is byte-equal to the concatenation of the 100 deltas. A `tool_execution_start` event between deltas flushes the buffer immediately.
  10. The `autoDismissUiRequests: false` option leaves `extension_ui_request` events un-handled (no stdin write, no auto-cancel).
- `test/pi-agent.test.ts` — rewritten (~7 cases):
  1. `onChunk` is called for every (debounced) `text_delta` event; the concatenation equals the full text from `getLastAssistantText()`.
  2. `onToolCall` is called for `read` with `{ phase: 'reading', name: 'read', args: { path: '...' } }`.
  3. `onToolCall` is called for `bash` with `{ phase: 'executing', name: 'bash', args: { command: '...' } }`.
  4. `SpawnPiAgentResult.sessionId` matches the live `getState().sessionId` (when the fake returns one), not the pre-computed one.
  5. The argv contains `--mode rpc` (and never `-p` — the test pins this).
  6. The `--name` / `--session-id` / `--tools` / `--skill` argv-shape tests (transport-agnostic) are preserved verbatim.
  7. `resolveSkillPaths` only includes existing skill directories on disk (the reviewer-flagged `includes` bug is gone; a non-existent path is dropped silently).
- `test/webfetch-research.test.ts` — extended (3 cases):
  1. The streaming config callback is invoked with `phase: 'reading'` when the subagent calls `read`.
  2. The streaming config callback is invoked with `phase: 'executing'` when the subagent calls `bash`.
  3. The `## Fetch Result (Agent Error)` fallback body is byte-equal to a fixture string (captured before the change and committed as `test/fixtures/agent-error-fallback.txt`); the assertion compares the full `result.content[0].text` to the fixture, not partial `startsWith` / `contains`. This pins the regression against `PLAN_AGENT_ERROR_RESUME.md`.
- `test/cli.test.ts`, `test/mcp-tools.test.ts`, `test/resume.test.ts` — sanity, no changes. The pre-existing assertions still hold because the public `webfetchResearch` shape is unchanged.

### Risks / Rollback

- **Risk:** the subagent's text-delta ordering differs from what `-p` mode used to deliver (one big final dump vs. a stream of deltas). The streaming caller treats chunks as "append to current output", which is correct, but the order of tool calls vs. text might surprise downstream rendering. **Mitigation:** the test surface pins the order; the experiment confirmed the event order (`message_update(text_delta)* → message_end → turn_end → agent_end`).
- **Risk:** the homebrew `pi` (0.78.1) and the in-`node_modules` `@mariozechner/pi-coding-agent` (0.70.6) drift in RPC protocol details (e.g., new event types). **Mitigation:** we only consume the documented stable events (`message_update`, `tool_execution_*`, `agent_end`, `extension_ui_request`). New event types are ignored by the JSONL reader's `try/catch` (actually, we forward them; the wrapper only listens to the known set). The `attachJsonlLineReader` helper is version-agnostic. The `package.json` peer dep is `"*"` and the devDep is `"latest"`; we do **not** pin a version in this plan. A future cleanup may pin and add a contract test that runs against the real `pi` binary in CI; that's a separate hardening pass.

- **Risk:** the upstream `RpcClient` has a 30-second per-command timeout (`pendingRequests.get(id)` in `node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client.js:382-385`). Our 50-line wrapper reimplements the request/response correlation and uses our own timeout (configurable, default 180s) — we do *not* inherit the 30s per-command limit. **Mitigation:** the wrapper's `send()` uses a `setTimeout` of `timeoutMs` for the *whole run* (not per-command), and `waitForIdle` is replaced with our own `agent_end` waiter. The 30s upstream limit is irrelevant to us. Tests pin: a `run({ timeoutMs: 30_000 })` rejects with `PiAgentError('Pi agent timed out after 30000ms')` if no `agent_end` arrives in 30s; a `run({ timeoutMs: 300_000 })` does *not* trip on the upstream 30s.

- **Risk:** the abort/SIGTERM/SIGKILL race can resolve the parent's `run()` promise with stale state (e.g., the child has emitted `agent_end` and is in the middle of `stop()`'s SIGTERM wait). **Mitigation:** the wrapper resolves on `agent_end` first; if the timeout fires after that, the `run()` has already resolved with the final text and the `stop()` is just cleanup. If `agent_end` never fires, the timeout calls `stop()`, which SIGTERMs and then SIGKILLs, and we reject with `PiAgentError('timed out')`. The wrapper is single-state-machine: `run()` either resolves with the final result or rejects with a `PiAgentError`; it never does both.
- **Risk:** the wrapper spawns `pi` from `PATH` but the user might have a different `pi` (e.g., a dev build). **Mitigation:** the wrapper accepts an explicit `piPath` option, defaulting to `'pi'`. The CLI and MCP surfaces don't override it; tests can. We document this in `docs/plans/PI_RPC_NOTES.md`.
- **Risk:** `extension_ui_request` auto-dismiss could mask a real bug in the subagent (e.g., a subagent extension that expects a dialog response). **Mitigation:** the research subagent runs with `--no-extensions` by default (or with an explicit extension allowlist via `-e`). The webfetch extension itself is not loaded into the subagent (the parent registers it; the subagent doesn't see the parent). So the only `extension_ui_request` events we see are from subagent-supplied extensions, which are user-controlled and out of scope for this plan. If the user adds an extension that calls UI, they get the auto-dismiss behavior — documented as a deliberate policy.
- **Risk:** the timeout race (abort + SIGTERM + SIGKILL) can leave the subagent in a half-written session file in `~/.pi/agent/sessions/`. **Mitigation:** the subagent session is a feature, not a leak. The user can `/resume` and pick it up; the half-written transcript still has the prompt + URL + fetched content + the start of the analysis, which is exactly what the resume flow is for.
- **Risk:** the byte-identical fallback content from `PLAN_AGENT_ERROR_RESUME.md` breaks accidentally when we refactor `spawnPiAgent`. **Mitigation:** `test/webfetch-research.test.ts` retains the regression assertion: `## Fetch Result (Agent Error) …` body is byte-equal to the pre-change baseline. The new transport changes `spawnPiAgent`'s internals, not the catch block in `webfetchResearch`.
- **Rollback:** there is no `-p` fallback to fall back to. If the JSON-RPC transport is broken in a way we can't quickly fix, the rollback is `git revert` of the relevant commits. The new `extensions/pi-rpc-client.ts` and its tests revert with the rest; `webfetchResearch` is unchanged in shape. To restore print-mode behavior, a single `git revert` of the transport commit is the entire rollback — no parallel paths to keep in sync.

## Incremental Plan

1. **[Verification: `pi-rpc-client` wrapper]** — write `extensions/pi-rpc-client.ts` and `test/pi-rpc-client.test.ts` (with a `FakePiRpc` driving the event surface via a mocked child-process or an inline fake). Verify: `npm test -- --run test/pi-rpc-client.test.ts` green. **The transport exists; the event surface is real; no real `pi` is spawned in tests.**
2. **[Core: refactor `spawnPiAgent` to use the wrapper]** — replace the print-mode `spawn` in `extensions/pi-agent.ts` with a call to `pi-rpc-client`. Add the optional `onToolCall` field to `SpawnPiAgentOptions`. Update `test/pi-agent.test.ts` to assert on `text_delta` events and the new `onToolCall` callback. Verify: `npm test -- --run test/pi-agent.test.ts` green. **The public API is unchanged; the transport is the new one.**
3. **[Surface: `webfetchResearch` threading]** — thread `onToolCall` from `webfetchResearch` to `spawnPiAgent`. Map the events to `phase: 'reading' | 'executing' | 'thinking'` in the streaming config. Update `sendStreamingUpdate` (or wrap it) to accept a phase string. Extend `test/webfetch-research.test.ts`. Verify: `npm test -- --run test/webfetch-research.test.ts` green. **The UX win is real: live tool progress in the TUI / CLI / MCP.**
4. **[Docs]** — `docs/plans/PI_RPC_NOTES.md` (protocol quirks), `CHANGELOG.md` (under "Changed"), `README.md` (one paragraph), `AGENTS.md` (one paragraph in Architecture Notes), `docs/plans/PLAN_AGENT_ERROR_RESUME.md` (one-line cross-reference). The TODO.md is rewritten in the same checklist style as the existing file (per-step headings + checkboxes) so the active step list is always current.
5. **[Polish]** — `npm run validate`; manual smoke from a real pi session: `/webfetch <url> "summarize"` against a moderately large page; observe live tool progress; force a failure (e.g., point at a URL the subagent can't fetch) and verify the byte-identical fallback + resume-command notify still work. Commit per step (one step per commit, conventional-commits subject).

## Definition of Done

- [ ] Steps 1–5 are merged with `npm run validate` green at each step.
- [ ] A real `/webfetch <url> "summarize"` call from a pi session shows live progress: `🧠 Analyzing content…` → `📖 reading input.md` → `🔧 bash: ls /tmp/…` → text deltas → final result.
- [ ] A real `/webfetch <url> "<query>"` that fails the subagent (e.g., unreachable URL inside the subagent) still produces the byte-identical `## Fetch Result (Agent Error)` fallback AND the resume-command notify AND the `subagentSessionId` / `subagentSessionName` / `resumeCommand` on `details`. The session is `pi --session <id>` resumable from the same cwd.
- [ ] The `## Fetch Result (Agent Error)` fallback content is byte-equal to the pre-change baseline (captured in `test/webfetch-research.test.ts`).
- [ ] `CHANGELOG.md` has an entry under "Changed" describing the transport switch and the new live-progress UX.
- [ ] `docs/plans/PI_RPC_NOTES.md` exists and covers the protocol quirks (LF-only framing, `extension_ui_request` auto-dismiss, `pi`-direct spawn, `getState` source of truth).
- [ ] `AGENTS.md` "Architecture Notes" has one paragraph on the JSON-RPC transport and the `onToolCall` callback.
- [ ] `npm run validate` is green (typecheck + lint + tests).
- [ ] `npm run build` is clean.
- [ ] `npm pack --dry-run` shows the new `dist/extensions/pi-rpc-client.js` and the updated `dist/extensions/pi-agent.js` in the package.
- [ ] No `TODO` / `FIXME` / debug code left behind.
- [ ] `TODO.md` is updated with the new plan's steps in the same checklist style as the existing file (per-step headings + checkboxes), and the previous plan's items are all marked complete.
