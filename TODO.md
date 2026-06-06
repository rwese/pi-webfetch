# Plan Implementation TODO

Plan: [PLAN_PI_JSONRPC.md](./docs/plans/PLAN_PI_JSONRPC.md) (Switch the research subagent to JSON-RPC for live feedback)

## Step 1 — `pi-rpc-client` wrapper

- [x] Create `extensions/pi-rpc-client.ts`:
  - `PiRpcClient` class (or factory) that spawns `pi --mode rpc` directly (not `node dist/cli.js`).
  - Reuse `attachJsonlLineReader` and `serializeJsonLine` from `@mariozechner/pi-coding-agent/dist/modes/rpc/jsonl.js` for the strict-JSONL framing.
  - Implement minimal request/response correlation (one pending command at a time).
  - Expose event API: `onText(cb)`, `onTool(cb)`, `onThinking(cb)`, plus `run({ prompt, signal?, timeoutMs? })` returning `{ text, sessionId, sessionName, exitCode, error? }`.
  - Auto-dismiss `extension_ui_request` events (cancel dialogs, silence notify/setStatus/setTitle) when `autoDismissUiRequests: true` (default `true`).
  - Spawn `pi` resolved via `findPiExecutable` (default `'pi'`); accept explicit `piPath` option for tests.
  - Inherit `cwd` / `env` from the spawn options.
  - Timeout strategy: wrapper owns the `agent_end` waiter (single `setTimeout(timeoutMs)`), then SIGTERM → SIGKILL cascade via `stop()`.
- [x] Map tool name → phase in the wrapper: `read` / `grep` / `find` / `ls` → `'reading'`, `bash` → `'executing'`, default → `'thinking'`.
- [x] Add `test/helpers/fake-pi-rpc.ts` (or `fake-pi-rpc-process.ts`) — `FakePiRpc` mirroring the wrapper's event surface; drives tests without spawning a real subprocess.
- [x] Add `test/pi-rpc-client.test.ts` (~10 cases per the plan):
  1. `--mode rpc` is spawned with the right argv (`--name`, `--session-id`, `--tools`, `--skill`, `--no-extensions`).
  2. `message_update` `text_delta` event fires the `onText` callback with the delta.
  3. `tool_execution_start` event fires `onTool` with `{ phase, name, args }`; phase mapping is correct.
  4. `agent_end` resolves `run({ prompt })` with `{ text, sessionId, sessionName, exitCode: 0 }`; `text` is from `getLastAssistantText()`.
  5. `extension_ui_request` `notify` is dropped (no stdin write).
  6. `extension_ui_request` `confirm` is answered with `{ type: "extension_ui_response", id, cancelled: true }`.
  7. Timeout (no `agent_end` in time) rejects with `PiAgentError('Pi agent timed out after Xms')` and the child is killed.
  8. Child process exiting with a non-zero code rejects with `PiAgentError(stderr || 'pi exited with code N', N, stderr)`.
  9. `onText` debouncing: 100 rapid `text_delta` events produce at most a small handful of `onText` calls; concatenated `text` is byte-equal; a `tool_execution_start` between deltas flushes immediately.
  10. `autoDismissUiRequests: false` leaves `extension_ui_request` events un-handled.
- [x] Verify: `npm test -- --run test/pi-rpc-client.test.ts` green.

## Step 2 — Refactor `spawnPiAgent` to use the wrapper

- [x] Replace the print-mode `spawn` in `extensions/pi-agent.ts` with a call to `pi-rpc-client`. Drop the `-p` argv building, the stdout drain, the print-mode `PiAgentError` paths entirely. No fallback branch, no parallel transport.
- [x] Add optional `onToolCall?: (event: { phase: 'reading' | 'executing' | 'thinking'; name: string; args: any }) => void` to `SpawnPiAgentOptions`. **Default: no-op** (back-compat with existing callers).
- [x] `onChunk` now fires for every (debounced) `message_update` `text_delta` event from the subagent. Concatenation equals `result.analysis` (byte-equal).
- [x] `SpawnPiAgentResult.sessionId` / `.sessionName` are the values returned by `getState()` on the live subagent, not just the pre-computed id.
- [x] `timeout` knob unchanged: rejects with `PiAgentError('Pi agent timed out after Xms', null)` if no `agent_end` in time. The wrapper owns the timer; no upstream 30s per-command limit.
- [x] Fix the `resolveSkillPaths` `includes` bug: use a real `fs.existsSync` check; drop non-existent skill dirs (with a debug-level log in tests).
- [x] Rewrite `test/pi-agent.test.ts` (~7 cases per the plan):
  1. `onChunk` is called for every (debounced) `text_delta` event; concatenation equals the full text from `getLastAssistantText()`.
  2. `onToolCall` is called for `read` with `{ phase: 'reading', name: 'read', args: { path: '...' } }`.
  3. `onToolCall` is called for `bash` with `{ phase: 'executing', name: 'bash', args: { command: '...' } }`.
  4. `SpawnPiAgentResult.sessionId` matches the live `getState().sessionId`, not the pre-computed one.
  5. The argv contains `--mode rpc` (and never `-p`).
  6. The `--name` / `--session-id` / `--tools` / `--skill` argv-shape tests (transport-agnostic) are preserved verbatim.
  7. `resolveSkillPaths` only includes existing skill directories on disk; non-existent path is dropped silently.
- [x] Delete tests that assert on stdout chunks or `-p` argv — they no longer model real behavior.
- [x] Verify: `npm test -- --run test/pi-agent.test.ts` green.

## Step 3 — Thread `onToolCall` through `webfetchResearch`

- [x] Add `'reading'` and `'executing'` to the `FetchPhase` union in `extensions/fetch-phases.ts` with friendly labels (`'📖 Reading input…'` / `'🔧 Running command…'`). Update both `FETCH_PHASE_LABELS` and the inline map in `getCommandPhaseLabel`.
- [x] Thread `onToolCall` through `extensions/services/research-service.ts::webfetchResearch` to `spawnPiAgent`. Map the events to streaming updates with `phase: 'reading' | 'executing' | 'thinking'` and a human-readable content string (`📖 reading <path>` / `🔧 bash: <command>`).
- [x] Extend `test/webfetch-research.test.ts`:
  1. When the subagent invokes `read`, the streaming `onUpdate` reflects `phase: 'reading'`.
  2. When the subagent invokes `bash`, the streaming `onUpdate` reflects `phase: 'executing'`.
  3. The `## Fetch Result (Agent Error)` fallback body is byte-equal to a fixture (pinned regression from `PLAN_AGENT_ERROR_RESUME.md`).
- [x] Verify: `npm test -- --run test/webfetch-research.test.ts` green.

## Step 4 — Docs

- [ ] Create `docs/plans/PI_RPC_NOTES.md` covering protocol quirks:
  - LF-only JSONL framing (why we use `attachJsonlLineReader`, not `node:readline`).
  - `extension_ui_request` auto-dismiss policy (default `true`, opt-out via wrapper option).
  - Spawn `pi` directly (not `node dist/cli.js`) for cold-start cost.
  - `getState()` is the source of truth for the live `sessionId` / `sessionName` on the result.
  - Single-path timeout (wrapper-owned `agent_end` waiter, SIGTERM → SIGKILL cascade).
- [ ] Add a `CHANGELOG.md` entry under "Changed" describing the transport switch and the new live-progress UX.
- [ ] Update `README.md`: one short paragraph on live feedback (no behavior change for callers, just a UX note).
- [ ] Update `AGENTS.md` "Architecture Notes" with one paragraph on the JSON-RPC transport and the new `onToolCall` callback.
- [ ] Add a one-line cross-reference in `docs/plans/PLAN_AGENT_ERROR_RESUME.md` pointing at the new plan.

## Step 5 — Polish

- [ ] `npm run validate` green (typecheck + lint + tests).
- [ ] `npm run build` clean.
- [ ] `npm pack --dry-run` and verify the new `dist/extensions/pi-rpc-client.js` and updated `dist/extensions/pi-agent.js` are present.
- [ ] Manual smoke (deferred to a real pi session): `/webfetch <url> "summarize"` against a moderately large page; observe live tool progress; force a failure and verify the byte-identical fallback + resume-command notify still work.
- [ ] Small, scoped commits per step (one step per commit, conventional-commits subject).

## Definition of Done

- [ ] All step items complete.
- [ ] `npm run validate` green.
- [ ] `CHANGELOG.md` has a "Changed" entry describing the transport switch and live-progress UX.
- [ ] `docs/plans/PI_RPC_NOTES.md` exists and covers the protocol quirks.
- [ ] `AGENTS.md` "Architecture Notes" has the JSON-RPC paragraph.
- [ ] `docs/plans/PLAN_AGENT_ERROR_RESUME.md` has the cross-reference.
- [ ] `npm run build` clean.
- [ ] `npm pack --dry-run` shows the new `dist/extensions/pi-rpc-client.js` and updated `dist/extensions/pi-agent.js`.
- [ ] No `TODO` / `FIXME` / debug code left behind.
- [ ] One commit per step, conventional-commits subject.
