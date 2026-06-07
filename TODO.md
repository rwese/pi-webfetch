# TODO — Browser session cleanup audit

Review finding (manual user report, 2026-06-07):
running `agent-browser session list` on the test host
shows 18+ active sessions, including the current
process's session. The user asked us to review the test
suite so we do proper cleanup of the spawned browser
sessions, and to **not** run a blanket
`agent-browser close --all` (which would kill other
running processes' sessions, including the user's pi /
codex sessions).

## Root causes

1. **`test/providers.test.ts:253`** — the
   `handles fetch error gracefully` test calls
   `manager.fetch("https://this-domain-does-not-exist-12345.com")`
   with the real `ProviderManager`. On hosts with
   `agent-browser` installed, this opens a real browser
   tab, then the `extractHtml` `finally` closes the tab —
   but the **session** is never closed. The session runs
   until the `agent-browser` host process exits (which is
   on the test host, not the test process).
2. **`test/browser-large-page.test.ts`** and
   **`test/browser-tab-isolation.test.ts`** create
   `BrowserManager` instances and call `extractHtml` but
   never call `m.close()`. The mock `execAsync` swallows
   the `agent-browser close` call so no real browser
   spawns, but the close path is not exercised (coverage
   gap) and any future test that drops the mock would
   leak.
3. **No process-level safety net.** If a test forgets to
   close, the test process exits and the session is
   orphaned.

## Plan

### Phase 1: per-test cleanup

- [x] **T1.1** `test/browser-large-page.test.ts`: wrap each test body in `try { … } finally { await m.close(); }`.
- [x] **T1.2** `test/browser-tab-isolation.test.ts`: same pattern. Most tests already rely on the per-tab `finally` inside `extractHtml`; we add the per-session `m.close()` as the outer cleanup.
- [x] **T1.3** `test/provider-net-error.test.ts`: confirm the existing `try/finally { await provider.close(); }` is in place (it is).

### Phase 2: deterministic error-handling test

- [x] **T2.1** `test/providers.test.ts:253` — replace the real network call with a deterministic test that injects a failing provider via `new ProviderManager({}, undefined, [failingProvider])` and asserts the manager returns `{ success: false, error, attemptedProviders }`. No real network, no real browser, no leak.
- [x] **T2.2** Confirm the flake (`handles fetch error gracefully` was the test that hit DNS timeouts) is gone.

### Phase 3: process-level safety net

- [x] **T3.1** Add `test/helpers/agent-browser-cleanup.ts`:
  - `registerProcessExitCleanup()` — registers `process.on('beforeExit')` to call `agent-browser close --session <deriveSessionName()>` for the current process. If `agent-browser --version` fails (not installed), the hook is a no-op.
  - `cleanupCurrentSession()` — manual cleanup helper, idempotent, safe to call multiple times.
  - **CRITICAL:** never call `agent-browser close --all`. Only close the session whose name matches `deriveSessionName()` (the current process). This avoids killing other running processes' sessions.
- [x] **T3.2** Add `test/setup.ts` that calls `registerProcessExitCleanup()` once. Wire it via `vitest.config.ts` `setupFiles`.
- [x] **T3.3** Confirm the test process cleans up its own session on `vitest run` exit.

### Phase 4: validate

- [x] **T4.1** `npm run validate` exits 0.
- [x] **T4.2** `agent-browser session list` before / after `npm test` shows the **current process's session** is added during the run and removed after.
- [x] **T4.3** Other processes' sessions are NOT touched.
- [x] **T4.4** Commit as `test(browser): clean up spawned sessions on test exit` (or similar).

## Commits

- `801a959` refactor(test): replace real-network error-handling test with deterministic mock-injected test
- `44ad1d9` test(browser): add per-test BrowserManager.close() cleanup
- _(pending)_ `test(browser): add process-level safety net for agent-browser session cleanup`
- _(pending)_ `docs: AGENTS.md / CHANGELOG.md / BACKLOG.md / TODO.md`

## Constraints

- **Do NOT** call `agent-browser close --all`. The
  user explicitly said "not to kill our testing
  environment host." The host has other running
  processes with their own sessions; closing all would
  orphan those.
- Only close the session owned by the current test
  process (matched by `${hostname}:${process.pid}`).
- The per-test cleanup pattern is the primary fix; the
  process-level safety net is belt-and-braces.
