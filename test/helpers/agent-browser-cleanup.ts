/**
 * agent-browser cleanup helpers for the test process
 *
 * Background: each `DefaultProvider` /
 * `BrowserManager` instance owns a per-process
 * `agent-browser` session tagged with
 * `${hostname}:${process.pid}` (see
 * `src/providers/internal/browser-manager.ts::deriveSessionName`).
 * A test that opens a tab and never calls
 * `provider.close()` / `manager.closeAll()` leaves the
 * session running on the host until the
 * `agent-browser` host process (which is **not** the
 * test process) shuts down. On a test host that runs
 * many `npm test` invocations, this accumulates
 * "zombie" sessions visible in `agent-browser session
 * list`.
 *
 * The per-test cleanup is the primary fix
 * (see `test/browser-large-page.test.ts`,
 * `test/browser-tab-isolation.test.ts`,
 * `test/provider-net-error.test.ts`). The helpers in
 * this file are the **process-level safety net**:
 *
 * - `registerProcessExitCleanup()` registers a
 *   `process.on('beforeExit')` hook that closes the
 *   current test process's session on exit. The hook
 *   is no-op if `agent-browser` is not installed.
 * - `cleanupCurrentSession()` is the manual variant,
 *   useful in `afterAll` hooks or for one-off
 *   debugging.
 * - **CRITICAL:** the helpers never call
 *   `agent-browser close --all`. Only the current
 *   process's session is closed. This avoids killing
 *   other running processes' sessions (e.g. the
 *   user's pi / codex sessions on the same host).
 *
 * Wired into the test suite via `test/setup.ts` and
 * `vitest.config.ts::setupFiles`.
 */

import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

/**
 * Test seam: the wrapped `execFile` is captured in a
 * module-scoped binding so tests can swap it via
 * `__setExecFileForTest`. Production code uses the
 * default `promisify(execFile)` from `node:child_process`
 * / `node:util`; only the `__setExecFileForTest` setter
 * overwrites it. The setter is exported only for tests.
 */
let execFileAsync: ((cmd: string, args: readonly string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>) = promisify(
	execFile,
) as typeof execFileAsync;

/**
 * Detect whether `agent-browser` is installed. We check
 * once per process and cache the result; the binary
 * cannot appear or disappear mid-test-run.
 */
let availabilityCache: { available: boolean; checked: boolean } = {
	available: false,
	checked: false,
};

async function isAgentBrowserAvailable(): Promise<boolean> {
	if (availabilityCache.checked) {
		return availabilityCache.available;
	}
	availabilityCache.checked = true;
	try {
		await execFileAsync('agent-browser', ['--version'], { timeout: 5_000 });
		availabilityCache.available = true;
	} catch {
		availabilityCache.available = false;
	}
	return availabilityCache.available;
}

/**
 * Test-only reset: clear the cached availability
 * result. The `test/setup.ts` file calls
 * `registerProcessExitCleanup()` once per process;
 * the availability cache and the `registered` flag
 * are normally process-lifetime. Tests that exercise
 * different `agent-browser` availability scenarios
 * (installed vs. not installed) need to clear the
 * cache between cases.
 */
export function __resetAvailabilityCacheForTest(): void {
	availabilityCache = { available: false, checked: false };
}

/**
 * Test-only escape hatch: swap the `execFile`-style
 * function the helper uses. Production never calls
 * this; tests use it to install a mock that
 * inspects the (cmd, args, options) tuple the helper
 * passes through. The default value is the
 * `promisify(execFile)` from `node:child_process` /
 * `node:util`. `__resetExecFileForTest` restores the
 * default.
 */
export function __setExecFileForTest(
	fn: typeof execFileAsync | null,
): void {
	if (fn === null) {
		execFileAsync = promisify(execFile) as typeof execFileAsync;
	} else {
		execFileAsync = fn;
	}
}

/**
 * The current process's session name, as it appears in
 * `agent-browser session list`. Matches the
 * `deriveSessionName()` shape in
 * `src/providers/internal/browser-manager.ts`.
 */
export function currentSessionName(): string {
	return `${hostname()}:${process.pid}`;
}

/**
 * Close the current test process's `agent-browser`
 * session. Idempotent; safe to call from
 * `afterAll`, `process.on('beforeExit')`, or any
 * other cleanup hook.
 *
 * The call is scoped to **only the current session**
 * (`agent-browser close --session <our-name>`). It
 * never calls `agent-browser close --all` \u2014 we
 * must not kill other running processes' sessions
 * (the user's pi / codex sessions on the same host).
 *
 * Returns `true` if the session was closed (or did
 * not exist) and `false` if the cleanup could not run
 * (e.g. `agent-browser` not installed, or the close
 * call failed). Either way, this function never
 * throws.
 */
export async function cleanupCurrentSession(): Promise<boolean> {
	if (!(await isAgentBrowserAvailable())) {
		return false;
	}
	const name = currentSessionName();
	try {
		await execFileAsync('agent-browser', ['close', '--session', name], {
			timeout: 5_000,
		});
		return true;
	} catch {
		// Swallow: the close call may fail if the
		// session is already gone (e.g. a previous
		// `cleanupCurrentSession` ran) or if
		// `agent-browser` rejects the session name
		// for some reason. Either way, we have done
		// what we can.
		return false;
	}
}

/**
 * Register a `process.on('beforeExit')` hook that
 * calls `cleanupCurrentSession()` on test-process
 * exit. The hook is registered once per process; a
 * second call is a no-op.
 *
 * Wire this from `test/setup.ts` so every
 * `npm run validate` / `vitest run` cleans up its
 * own session on exit, even if a test forgot to
 * close its providers.
 */
let registered = false;
let beforeExitFired = false;
export function registerProcessExitCleanup(): void {
	if (registered) return;
	registered = true;
	process.on('beforeExit', () => {
		// `beforeExit` fires when the event loop is
		// about to drain. We schedule an async
		// cleanup (`cleanupCurrentSession` shells out
		// to `agent-browser close --session <name>`)
		// and intentionally do NOT await it.
		// `beforeExit` listeners are synchronous, so
		// awaiting here would defeat the purpose.
		//
		// CRITICAL: the async cleanup keeps the
		// event loop alive (a pending Promise
		// schedules a microtask), so Node re-fires
		// `beforeExit` repeatedly until the loop
		// truly drains. Without the `beforeExitFired`
		// guard, the cleanup would run many times
		// (each `agent-browser close` is a few
		// milliseconds, but the loop is busy for as
		// long as the Promise is pending). The guard
		// fires the cleanup exactly once per process
		// exit, then the loop drains and Node exits
		// normally.
		if (beforeExitFired) return;
		beforeExitFired = true;
		void cleanupCurrentSession();
	});
}

/**
 * Test-only reset: clear the `registered` flag so
 * `registerProcessExitCleanup()` can be re-tested.
 * Does NOT remove the actual `beforeExit` listener
 * (the test is responsible for that; see
 * `test/agent-browser-cleanup.test.ts`).
 */
export function __resetRegisteredFlagForTest(): void {
	registered = false;
	beforeExitFired = false;
}
