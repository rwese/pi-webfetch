/**
 * Vitest global setup
 *
 * Runs once per test process, before any test file. Used
 * here to register the per-process `agent-browser` cleanup
 * hook (see `test/helpers/agent-browser-cleanup.ts` for
 * the full rationale).
 *
 * Why a setup file (and not per-test cleanup) is needed:
 *
 * - Per-test cleanup (the primary fix) requires every
 *   test that spawns a `DefaultProvider` / `BrowserManager`
 *   to call `close()` in a `finally` block. We have
 *   audited and fixed the known offenders, but new tests
 *   could regress.
 * - The setup file is the **belt-and-braces** safety net:
 *   on `process.on('beforeExit')`, the current test
 *   process's `agent-browser` session is closed. The
 *   hook is scoped to **only the current session**
 *   (matched by `${hostname}:${process.pid}`); it never
 *   calls `agent-browser close --all` and so does not
 *   touch other running processes' sessions.
 *
 * Wired via `vitest.config.ts::setupFiles`.
 */

import { registerProcessExitCleanup } from './helpers/agent-browser-cleanup.js';

registerProcessExitCleanup();
