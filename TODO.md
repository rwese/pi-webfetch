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

- [x] Create `docs/plans/PI_RPC_NOTES.md` covering protocol quirks:
  - LF-only JSONL framing (why we use `attachJsonlLineReader`, not `node:readline`).
  - `extension_ui_request` auto-dismiss policy (default `true`, opt-out via wrapper option).
  - Spawn `pi` directly (not `node dist/cli.js`) for cold-start cost.
  - `getState()` is the source of truth for the live `sessionId` / `sessionName` on the result.
  - Single-path timeout (wrapper-owned `agent_end` waiter, SIGTERM → SIGKILL cascade).
- [x] Add a `CHANGELOG.md` entry under "Changed" describing the transport switch and the new live-progress UX.
- [x] Update `README.md`: one short paragraph on live feedback (no behavior change for callers, just a UX note).
- [x] Update `AGENTS.md` "Architecture Notes" with one paragraph on the JSON-RPC transport and the new `onToolCall` callback.
- [x] Add a one-line cross-reference in `docs/plans/PLAN_AGENT_ERROR_RESUME.md` pointing at the new plan.

## Step 5 — Polish

- [x] `npm run validate` green (typecheck + lint + tests).
- [x] `npm run build` clean.
- [x] `npm pack --dry-run` and verify the new `dist/extensions/pi-rpc-client.js` and updated `dist/extensions/pi-agent.js` are present.
- [ ] Manual smoke (deferred to a real pi session): `/webfetch <url> "summarize"` against a moderately large page; observe live tool progress; force a failure and verify the byte-identical fallback + resume-command notify still work.
- [x] Small, scoped commits per step (one step per commit, conventional-commits subject).

## Definition of Done

- [x] All step items complete (manual smoke is the only remaining item; deferred to a real pi session).
- [x] `npm run validate` green.
- [x] `CHANGELOG.md` has a "Changed" entry describing the transport switch and live-progress UX.
- [x] `docs/plans/PI_RPC_NOTES.md` exists and covers the protocol quirks.
- [x] `AGENTS.md` "Architecture Notes" has the JSON-RPC paragraph.
- [x] `docs/plans/PLAN_AGENT_ERROR_RESUME.md` has the cross-reference.
- [x] `npm run build` clean.
- [x] `npm pack --dry-run` shows the new `dist/extensions/pi-rpc-client.js` and updated `dist/extensions/pi-agent.js`.
- [x] No `TODO` / `FIXME` / debug code left behind.
- [x] One commit per step, conventional-commits subject.

---

# Plan Implementation TODO

Plan: [PLAN_WEBFETCH_REVIEW_FIXES.md](./docs/plans/PLAN_WEBFETCH_REVIEW_FIXES.md) (Address all 11 findings from the 2026-06-06 hands-on review in v0.9.0)

## Goal

Ship v0.9.0 that fixes every finding in
[`docs/reviews/webfetch-review-2026-06-06.md`](./docs/reviews/webfetch-review-2026-06-06.md).
Three internal milestones (correctness → fidelity → polish), one
release. Order matters: M1 must land before M2 (the cache test
fixtures for M2 depend on the M1 TTL helpers), and M2 must land
before M3 (the markdown snapshots updated in M2 also appear in M3
tests).

## Milestone 1 — Correctness (BLOCKER; Findings 1 + 6) — Done

### Ready

- [x] **M1.A** — TTL: add `isFresh(entry, ttlMs)` in `extensions/cache.ts`; thread `cacheTtlMs?: number` through `getCachedResult` and `cacheFetchResult`; default TTL = 1 h. CLI / MCP / pi-tool / extension surface the option. Add `test/cache-ttl.test.ts`. **Verify:** `npm test -- --run test/cache-ttl.test.ts` green; `npm run validate` green.
- [x] **M1.B** — Content validation: add `validateCacheEntry(entry, requestedUrl)`; compare `<title>` / `finalUrl` against the requested URL; mismatch → log warning on `details.notify` / stderr / `_meta.details.notify`; do not persist. Add `test/cache-content-validation.test.ts` with a poisoned fixture. **Verify:** the new test passes; existing `test/cases/*` regression snapshots remain green.
- [x] **M1.C** — Per-process session: in `BrowserManager` constructor, compute `sessionName = `${os.hostname()}:${process.pid}``; pass via `AGENT_BROWSER_SESSION` env var (or `--session` argv) on every `execAsync` call. Update existing `BrowserManager` tests to assert the env is set. **Verify:** `npm test -- --run test/resource-cleanup.test.ts` green.
- [x] **M1.D** — Per-fetch tab: replace the `currentUrl` skip-open shortcut with a per-fetch tab id (`crypto.randomUUID()`). `extractHtml` always opens a new tab; closes it in `finally`. Remove the idle timeout and the `currentUrl` field. Add `test/browser-tab-isolation.test.ts`. **Verify:** the new test green; `npm run validate` green.
- [x] **M1.E** — Clear-cache flags: add `clearAllCache({ olderThanMs })` and `clearCacheOlderThan(url, ms)` in `cache.ts`. Register the new `webfetch:clear-cache` command with `--all`, `--older-than <duration>`, `--dry-run`. Document in help and README. **Verify:** `test/clear-cache-flags.test.ts` green.
- [x] **M1.F** — Docs: write `docs/cache.md`; add CHANGELOG "Added" / "Changed" entries; update README with `--cache-ttl`, the new `webfetch-clear-cache` flags, and a link to `docs/cache.md`; update `BACKLOG.md` with the 2026-06-06 review table. **Verify:** `npm run validate` green; `npm run build` clean; `npm pack --dry-run` shows updated files.

## Milestone 2 — Markdown fidelity (Findings 2, 3, 4, 5) — Done

### Ready

- [x] **M2.A** — Pin current image behaviour: add `test/image-inlining.test.ts` against a Wikipedia fixture that pins the **current** broken `[ref-N]` shape (the "before" snapshot).
- [x] **M2.B** — Inline images by default: rewrite `extractEmbeddedImages` to emit `![alt](absolute-url)`; keep the extract-to-temp-file path as a non-default opt-in. Update `test/image-inlining.test.ts` to assert the new shape.
- [x] **M2.C** — Denylist: add the selector denylist in `cleanHtml` and `BrowserManager.extractHtml` cheerio pre-pass. Add `test/denylist.test.ts`.
- [x] **M2.D** — Wikitable turndown rule: add `wikitables` rule in `turndown-config.ts`; register after `preserveCodeBlocks`. Add `test/table-wikitables.test.ts`.
- [x] **M2.E** — Un-escape brackets: add `unescapeMarkdownBrackets(markdown)` in `extensions/markdown.ts`; call from `removeMarkdownAnchors` (or a new post-processing pass). Add `test/markdown-unescape.test.ts`.
- [x] **M2.F** — Refresh `test/cases/*` snapshots (Wikipedia Pi / Apollo-11); rerun `npm run test:regression` and `npm run report-url`; CHANGELOG "Changed" entry.

### Blocked

- none

### Done

- All M2 tasks complete.

## Milestone 3 — Polish (Findings 7, 8, 9, 10, 11) — Done

### Ready

- [x] **M3.A** — Pin current `provider` name: add `test/provider-name.test.ts` that pins `details.provider === 'default'` against the current code.
- [x] **M3.B** — Rename `default` → `browser` in user-facing surfaces: `DefaultProvider.fetch` returns `providerName: 'browser'`; document the user-facing enum; update `test/provider-name.test.ts`.
- [x] **M3.C** — Widen `processedAs` union: add `'html'` and `'static'`; `DefaultProvider.fetch` reports `'spa'` for `waitFor === 'networkidle'`, `'html'` for `'domcontentloaded'`. Rename `'fallback'` to `'static'` in the static-fetch path (snapshot update). Add `test/processed-as-labels.test.ts`.
- [x] **M3.D** — Sticky `staticOnly` warning: hoist the "have we shown the warning yet" flag to module scope; per-call `browserWarning` becomes once-only content line + sticky `details.staticOnly: true`. Add `test/static-only-warning.test.ts`.
- [x] **M3.E** — Finding 9 verification: re-run `test/static-fetch-raw.test.ts` and `test/research-input-files.test.ts`; document the no-op in CHANGELOG / BACKLOG with a "verified, no code change needed" note.
- [x] **M3.F** — README + CHANGELOG + final regression: update README with the new flags, the `staticOnly` flag, the `provider` enum; CHANGELOG entries for M3; rerun `npm run test:regression` and `npm run report-url` against the live URLs in the review's test matrix.

## Definition of Done (for the release)

- [ ] Every M1, M2, M3 task above is complete.
- [ ] `npm run validate` is green.
- [ ] `npm run build` is clean.
- [ ] `npm pack --dry-run` shows updated `dist/`, `extensions/`, `src/`, `docs/`, `README.md`, `CHANGELOG.md`.
- [ ] CHANGELOG has "Added" / "Changed" / "Fixed" entries covering all three milestones.
- [ ] README documents `--cache-ttl`, `cacheTtlMs`, the new `webfetch-clear-cache` flags, the `staticOnly` flag, and the `provider` enum.
- [ ] `docs/cache.md` exists.
- [ ] `BACKLOG.md` has a 2026-06-06 review table mirroring the 2026-06-05 one, with each finding's status set after v0.9.0 ships.
- [ ] One commit per milestone (three total), conventional-commits subjects.
- [ ] No `TODO` / `FIXME` / debug code in the diff.
- [ ] Pre-commit hooks pass.
- [ ] Smoke test in a real pi session: re-run the review's test matrix (URLs 1, 2, 6, 11, 12) and confirm call #11 returns the correct Wikipedia content (no cache poisoning).
