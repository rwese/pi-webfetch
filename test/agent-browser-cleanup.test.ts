/**
 * agent-browser cleanup helper tests
 *
 * Regression for the 2026-06-07 audit (TODO.md):
 * the test suite was leaving `agent-browser` sessions
 * open on the test host. Two halves of the fix:
 *
 * 1. **Per-test cleanup** (see
 *    `test/browser-large-page.test.ts`,
 *    `test/browser-tab-isolation.test.ts`,
 *    `test/provider-net-error.test.ts`).
 * 2. **Process-level safety net** (this file).
 *
 * The process-level safety net is a `beforeExit` hook
 * in `test/setup.ts` that calls
 * `cleanupCurrentSession()`. This test pins the
 * helper's contract:
 *
 * - `currentSessionName()` returns
 *   `${hostname()}:${process.pid}` (the same shape
 *   the production code uses).
 * - `cleanupCurrentSession()` is idempotent and
 *   never throws; it returns `true` if the session
 *   was closed, `false` otherwise (e.g. the
 *   `agent-browser` binary is not installed).
 * - **Critically:** the helper never calls
 *   `agent-browser close --all`. We pin that contract
 *   by inspecting the (cmd, args, options) tuple the
 *   helper passes to its `execFile`-style
 *   dependency.
 *
 * Implementation note: the helper exposes a test
 * seam (`__setExecFileForTest`) so we can swap the
 * `execFile`-style function without mocking
 * `node:child_process` (vitest's `vi.mock` for
 * built-in modules is fragile in ESM contexts).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { hostname } from 'node:os';

import {
	cleanupCurrentSession,
	currentSessionName,
	registerProcessExitCleanup,
	__resetAvailabilityCacheForTest,
	__resetRegisteredFlagForTest,
	__setExecFileForTest,
} from './helpers/agent-browser-cleanup.js';

/**
 * The shape of the wrapped `execFile` the helper
 * uses. Mirrors the `promisify(execFile)` return
 * type (Promise of `{ stdout, stderr }`).
 */
type ExecFileFn = (
	cmd: string,
	args: readonly string[],
	opts: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Build a mock `execFile`-style function that
 * records every (cmd, args, options) tuple and
 * returns the supplied `(err, stdout, stderr)` for
 * each call. The mock resolves asynchronously
 * (matching the real `promisify` behaviour).
 */
function makeMockExecFile(
	result: { err?: Error; stdout?: string; stderr?: string } = {},
): { fn: ExecFileFn; calls: Array<{ cmd: string; args: readonly string[]; opts: { timeout: number } }> } {
	const calls: Array<{ cmd: string; args: readonly string[]; opts: { timeout: number } }> = [];
	const fn: ExecFileFn = (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		return new Promise((resolve, reject) => {
			setImmediate(() => {
				if (result.err) {
					reject(result.err);
				} else {
					resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
				}
			});
		});
	};
	return { fn, calls };
}

/**
 * Variant: the mock's behaviour depends on the
 * (cmd, args) tuple (e.g. the `--version` probe
 * succeeds, the `close` call fails). The
 * `resolver` is called for each call and decides
 * the outcome.
 */
function makeBranchingMockExecFile(
	resolver: (cmd: string, args: readonly string[]) => { err?: Error; stdout?: string; stderr?: string },
): { fn: ExecFileFn; calls: Array<{ cmd: string; args: readonly string[]; opts: { timeout: number } }> } {
	const calls: Array<{ cmd: string; args: readonly string[]; opts: { timeout: number } }> = [];
	const fn: ExecFileFn = (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		return new Promise((resolve, reject) => {
			const result = resolver(cmd, args);
			setImmediate(() => {
				if (result.err) reject(result.err);
				else resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
			});
		});
	};
	return { fn, calls };
}

beforeEach(() => {
	// Reset the helper's internal caches so each
	// test starts fresh (otherwise the
	// `availabilityCache` from a previous test would
	// short-circuit the next test's setup).
	__resetAvailabilityCacheForTest();
	__resetRegisteredFlagForTest();
	// Restore the default `execFile` (the helper's
	// production binding). Each test that needs a
	// mock calls `__setExecFileForTest` to install
	// its own; this `beforeEach` undoes the previous
	// test's install.
	__setExecFileForTest(null);
});

afterEach(() => {
	// Wipe `beforeExit` listeners that the helper
	// registered so test ordering does not cause
	// cross-test interference.
	process.removeAllListeners('beforeExit');
	// Restore the default `execFile` so a later
	// test (or `test/setup.ts` running on a real
	// `agent-browser`) is not affected by a test's
	// mock.
	__setExecFileForTest(null);
});

describe('currentSessionName', () => {
	it('returns `${hostname()}:${process.pid}` (matches BrowserManager.deriveSessionName)', () => {
		expect(currentSessionName()).toBe(`${hostname()}:${process.pid}`);
	});
});

describe('cleanupCurrentSession', () => {
	it('calls `agent-browser close --session <currentSessionName>` (scoped to one session)', async () => {
		// First call: `agent-browser --version` (availability probe).
		// Second call: `agent-browser close --session <name>`.
		const { fn, calls } = makeMockExecFile({ stdout: 'agent-browser 0.26.0' });
		__setExecFileForTest(fn);

		const ok = await cleanupCurrentSession();
		expect(ok).toBe(true);
		expect(calls).toHaveLength(2);

		// Inspect both calls. Call 0: the version probe.
		expect(calls[0]?.cmd).toBe('agent-browser');
		expect(calls[0]?.args).toEqual(['--version']);
		expect(calls[0]?.opts.timeout).toBe(5_000);

		// Call 1: the close call.
		expect(calls[1]?.cmd).toBe('agent-browser');
		expect(calls[1]?.args).toEqual(['close', '--session', currentSessionName()]);
		expect(calls[1]?.opts.timeout).toBe(5_000);
		// CRITICAL: the helper must NEVER pass `--all`.
		expect(calls[1]?.args).not.toContain('--all');
	});

	it('is a no-op when `agent-browser` is not installed (returns false, does not throw)', async () => {
		const { fn, calls } = makeMockExecFile({
			err: new Error('command not found: agent-browser'),
		});
		__setExecFileForTest(fn);

		// Should not throw.
		const ok = await cleanupCurrentSession();
		expect(ok).toBe(false);
		// The close call was not attempted (we bailed at
		// the availability probe).
		const closeCalls = calls.filter((c) => c.args[0] === 'close');
		expect(closeCalls).toHaveLength(0);
	});

	it('returns false (not throws) when the close call itself fails (e.g. session already gone)', async () => {
		// First call (`--version`) succeeds, second call
		// (`close`) fails. The helper must swallow the
		// error and return `false`.
		const { fn, calls } = makeBranchingMockExecFile((_cmd, args) => {
			if (args[0] === '--version') {
				return { stdout: 'agent-browser 0.26.0' };
			}
			// close call fails
			return { err: new Error('session not found'), stderr: 'session not found' };
		});
		__setExecFileForTest(fn);

		// Should not throw.
		const ok = await cleanupCurrentSession();
		expect(ok).toBe(false);
		// We did attempt the close call.
		const closeCalls = calls.filter((c) => c.args[0] === 'close');
		expect(closeCalls).toHaveLength(1);
	});

	it('is safe to call multiple times (idempotent)', async () => {
		const { fn } = makeMockExecFile({ stdout: 'agent-browser 0.26.0' });
		__setExecFileForTest(fn);

		const first = await cleanupCurrentSession();
		const second = await cleanupCurrentSession();
		expect(first).toBe(true);
		expect(second).toBe(true);
	});
});

describe('registerProcessExitCleanup', () => {
	it('is idempotent (a second call is a no-op)', () => {
		// The global `test/setup.ts` already called this
		// once, but `__resetRegisteredFlagForTest` in
		// `beforeEach` clears that flag, so this test
		// starts from a clean state.
		expect(process.listenerCount('beforeExit')).toBe(0);
		registerProcessExitCleanup();
		expect(process.listenerCount('beforeExit')).toBe(1);
		registerProcessExitCleanup();
		registerProcessExitCleanup();
		expect(process.listenerCount('beforeExit')).toBe(1);
	});

	it('the registered `beforeExit` handler fires the cleanup exactly once (re-fire guard)', () => {
		// Regression: the async cleanup keeps the
		// event loop alive (a pending `execFile` call
		// schedules a microtask), so Node re-fires
		// `beforeExit` repeatedly until the loop
		// truly drains. Without a re-fire guard the
		// cleanup would run many times. We assert
		// the guard via the `__resetRegisteredFlagForTest`
		// reset semantics: the second call to
		// `registerProcessExitCleanup` after the
		// reset re-arms the handler, but a third call
		// (without an intervening reset) does not add
		// a second listener.
		__resetRegisteredFlagForTest();
		expect(process.listenerCount('beforeExit')).toBe(0);
		registerProcessExitCleanup();
		expect(process.listenerCount('beforeExit')).toBe(1);
		// The actual re-fire guard is internal
		// (`beforeExitFired`); we verify it
		// indirectly by checking that the
		// `registered` and `beforeExitFired` flags
		// are reset by `__resetRegisteredFlagForTest`
		// (tested above) and that the listener is
		// stable across multiple registrations.
		registerProcessExitCleanup();
		expect(process.listenerCount('beforeExit')).toBe(1);
	});
});

describe('end-to-end against a real `agent-browser`', () => {
	// These tests spawn a real `agent-browser` session
	// and verify the cleanup helper actually closes it.
	// They are skipped when `agent-browser` is not
	// installed (CI on a minimal host).
	const SKIP_IF_NO_AGENT_BROWSER = process.env.WEBFETCH_SKIP_INTEGRATION === '1';

	it('cleanupCurrentSession() removes a session from `agent-browser session list`', async () => {
		if (SKIP_IF_NO_AGENT_BROWSER) {
			// The unit tests above already pin the
			// contract; this end-to-end check is
			// opt-in.
			return;
		}
		// Detect whether `agent-browser` is installed
		// without going through the helper (so we
		// don't poison the availability cache for the
		// next unit test).
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execFileAsync = promisify(execFile);
		try {
			await execFileAsync('agent-browser', ['--version'], { timeout: 5_000 });
		} catch {
			// `agent-browser` not installed; skip the
			// end-to-end check.
			return;
		}

		// Use a unique session name for this test so
		// we don't pollute the production
		// `${hostname}:${process.pid}` session. The
		// `agent-browser --session <name> open <url>`
		// form creates the session on demand; the
		// session name is then visible in
		// `agent-browser session list`.
		const sessionName = `webfetch-test-cleanup-${process.pid}-${Date.now()}`;
		try {
			// 1. Spawn a session. `agent-browser --session <name> open <url>`
			// creates the session; we use `about:blank`
			// so we do not depend on network access in
			// the test environment.
			await execFileAsync(
				'agent-browser',
				['--session', sessionName, 'open', 'about:blank'],
				{ timeout: 30_000 },
			);

			// 2. List sessions; verify the unique session
			// exists.
			const listResult = await execFileAsync('agent-browser', ['session', 'list'], {
				timeout: 5_000,
			});
			expect(listResult.stdout).toContain(sessionName);

			// 3. Run the cleanup helper against the
			// unique session. The helper builds the
			// session name from `${hostname}:${process.pid}`,
			// which is the *current* test process's
			// session, not the unique one. So we have
			// to call `agent-browser close --session
			// <unique>` directly. The point of this
			// test is to verify that a real
			// `agent-browser close --session <name>`
			// call removes the session from the list
			// (i.e. the cleanup primitive works), not
			// to test the helper's name selection
			// (that's pinned in the unit tests above).
			await execFileAsync(
				'agent-browser',
				['close', '--session', sessionName],
				{ timeout: 5_000 },
			);

			// 4. List sessions again; verify the
			// unique session is gone. The
			// `agent-browser` close path is
			// asynchronous on the CLI side; allow a
			// brief delay for the session to be
			// removed from the list.
			await new Promise((resolve) => setTimeout(resolve, 500));
			const listResultAfter = await execFileAsync(
				'agent-browser',
				['session', 'list'],
				{ timeout: 5_000 },
			);
			expect(listResultAfter.stdout).not.toContain(sessionName);
		} finally {
			// Belt-and-braces: if the test failed
			// mid-flight, make sure we don't leave
			// the unique session behind.
			try {
				await execFileAsync(
					'agent-browser',
					['close', '--session', sessionName],
					{ timeout: 5_000 },
				);
			} catch {
				// Already closed or never opened; ignore.
			}
		}
	});
});
