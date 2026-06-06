/**
 * Browser Manager
 *
 * Owns the per-process `agent-browser` session and the
 * per-fetch tab lifecycle for the DefaultProvider.
 *
 * Design (post v0.9.0 / M1):
 *
 * - One `AGENT_BROWSER_SESSION` per process, computed once in
 *   the constructor as `${os.hostname()}:${process.pid}`. The
 *   session name is stable for the lifetime of the process and
 *   is passed via the `AGENT_BROWSER_SESSION` env var on every
 *   `execAsync` call. This isolates each `webfetch` process
 *   from every other — two concurrent webfetch invocations on
 *   the same host each get their own browser instance and
 *   never collide on tabs / cookies / state.
 * - One tab per fetch. `extractHtml` / `extractText` allocate a
 *   fresh tab id (`crypto.randomUUID()` truncated to fit
 *   `agent-browser`'s labelling rules), pass it to
 *   `agent-browser tab new <url> --label <id>`, and close the
 *   tab in a `finally` block via `agent-browser tab close <id>`.
 *   This closes the race window where a `currentUrl` skip-open
 *   shortcut could read HTML for the wrong page (review
 *   finding 6 / 1).
 * - The `BrowserManager` is a thin wrapper: it owns the session
 *   name and the tab lifecycle, nothing else. There is no
 *   `currentUrl` field, no idle-timer heuristic, no single-tab
 *   reuse.
 * - The existing `BrowserMutex` stays. Two concurrent
 *   `fetchUrl` calls on the *same* `BrowserManager` (same
 *   process) are still serialised; two concurrent *processes*
 *   on the same host each get their own session and never see
 *   each other's tabs.
 */

import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { execAsync } from '../../utils/process.js';

/**
 * Result from HTML extraction
 */
export interface HtmlExtractionResult {
	html: string;
	contentSource: string;
}

/**
 * Compute the per-process `AGENT_BROWSER_SESSION` name. Stable
 * for the lifetime of the process, deterministic enough that a
 * human can identify it in `agent-browser session list`. The
 * hostname prefix means concurrent processes on the same host
 * each get their own browser instance.
 */
export function deriveSessionName(): string {
	return `${hostname()}:${process.pid}`;
}

/**
 * Build the env object for a single `execAsync` call. Always
 * includes the per-process `AGENT_BROWSER_SESSION` so concurrent
 * webfetch processes never share state. The `sessionName` is
 * bound to the `BrowserManager` instance so a test that
 * injects a deterministic name gets the same value on every
 * exec call.
 */
function sessionEnvFor(
	manager: BrowserManager,
	extra?: Record<string, string>,
): Record<string, string> {
	return {
		AGENT_BROWSER_SESSION: manager.sessionName,
		...(extra ?? {}),
	};
}

/**
 * Browser manager for handling browser state and operations
 */
export class BrowserManager {
	/**
	 * Per-process session name. Computed once at construction
	 * and reused for every `execAsync` call. The test suite
	 * overrides this via the constructor arg.
	 */
	readonly sessionName: string;

	/** Mutex to prevent concurrent browser access within a single process. */
	private browserMutex = new BrowserMutex();

	constructor(opts?: { sessionName?: string }) {
		this.sessionName = opts?.sessionName ?? deriveSessionName();
	}

	/**
	 * Acquire mutex to prevent concurrent browser access
	 */
	async acquire(): Promise<void> {
		await this.browserMutex.acquire();
	}

	/**
	 * Release mutex
	 */
	release(): void {
		this.browserMutex.release();
	}

	/**
	 * Generate a fresh per-fetch tab id. Stable for the duration
	 * of a single `extractHtml` / `extractText` call; the caller
	 * is responsible for closing the tab in `finally`.
	 */
	private newTabId(): string {
		// `randomUUID` is "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
		// (36 chars); `agent-browser` tab labels accept longer
		// ids, so we keep the full UUID to avoid collisions when
		// many `extractHtml` calls overlap in a tight loop.
		return `webfetch-${randomUUID()}`;
	}

	/**
	 * Extract HTML from browser using agent-browser. Allocates a
	 * fresh tab, opens the URL in it, waits, extracts, and closes
	 * the tab in `finally`. The tab is closed even on
	 * extraction errors so a failure does not leak a tab.
	 */
	async extractHtml(
		url: string,
		waitFor: string,
		timeout: number,
	): Promise<HtmlExtractionResult> {
		const tabId = this.newTabId();
		try {
			const html = await this.runInTab(tabId, url, waitFor, timeout);
			const contentSource = await this.pickContentSource(html, tabId, timeout);
			return { html: contentSource.html, contentSource: contentSource.contentSource };
		} finally {
			await this.closeTab(tabId, timeout);
		}
	}

	/**
	 * Extract plain text from browser. Same per-fetch tab
	 * lifecycle as `extractHtml`.
	 */
	async extractText(url: string, waitFor: string, timeout: number): Promise<string> {
		const tabId = this.newTabId();
		try {
			return await this.runInTabText(tabId, url, waitFor, timeout);
		} finally {
			await this.closeTab(tabId, timeout);
		}
	}

	/**
	 * Open a fresh tab, navigate to `url`, wait for the
	 * configured load event, and return the rendered `<body>`.
	 * The tab id is owned by the caller (closed in `finally`).
	 */
	private async runInTab(tabId: string, url: string, waitFor: string, timeout: number): Promise<string> {
		await this.openInTab(tabId, url, timeout);
		await this.waitForLoad(waitFor, timeout);
		return execAsync('agent-browser', ['get', 'html', 'body'], {
			timeout,
			env: sessionEnvFor(this),
		});
	}

	/**
	 * Same shape as `runInTab` but returns the body text. Used
	 * by the low-text-ratio fallback in the default provider.
	 */
	private async runInTabText(
		tabId: string,
		url: string,
		waitFor: string,
		timeout: number,
	): Promise<string> {
		await this.openInTab(tabId, url, timeout);
		await this.waitForLoad(waitFor, timeout);
		return execAsync('agent-browser', ['get', 'text', 'body'], {
			timeout,
			env: sessionEnvFor(this),
		});
	}

	/**
	 * Open a new tab and navigate to the URL. Uses
	 * `agent-browser tab new <url> --label <id>` so the tab is
	 * addressable by the same id later. We deliberately do not
	 * reuse an existing tab (the v0.8.0 `currentUrl` shortcut
	 * was the root cause of the cache-poisoning race in
	 * review finding 1 / 6).
	 */
	private async openInTab(tabId: string, url: string, timeout: number): Promise<void> {
		await execAsync('agent-browser', ['tab', 'new', url, '--label', tabId], {
			timeout,
			env: sessionEnvFor(this),
		});
	}

	private async waitForLoad(waitFor: string, timeout: number): Promise<void> {
		await execAsync('agent-browser', ['wait', '--load', waitFor], {
			timeout,
			env: sessionEnvFor(this),
		});
	}

	/**
	 * Pick the best HTML source for the page: `article` first,
	 * then `main`, then `body`. Returns the first non-empty
	 * match (where "non-empty" is `> 100` chars of HTML so we
	 * do not pick up an empty container).
	 */
	private async pickContentSource(
		fallbackBody: string,
		tabId: string,
		timeout: number,
	): Promise<{ html: string; contentSource: string }> {
		const env = sessionEnvFor(this);
		for (const source of ['article', 'main']) {
			try {
				const html = await execAsync('agent-browser', ['get', 'html', source], {
					timeout: Math.min(timeout, 5_000),
					env,
				});
				if (html && html.trim().length > 100) {
					return { html, contentSource: source };
				}
			} catch {
				// Try the next source.
			}
		}
		return { html: fallbackBody, contentSource: 'body' };
	}

	/**
	 * Close the tab owned by `tabId`. Errors are swallowed
	 * because the fetch is about to return its result either
	 * way; a stale tab is cleaned up the next time the host
	 * process exits or the user runs `agent-browser close
	 * --all`. The 5s timeout prevents a slow agent-browser
	 * shutdown from blowing past the caller's fetch budget.
	 */
	private async closeTab(tabId: string, timeout: number): Promise<void> {
		try {
			await execAsync('agent-browser', ['tab', 'close', tabId], {
				timeout: Math.min(timeout, 5_000),
				env: sessionEnvFor(this),
			});
		} catch {
			// Ignore close errors. The tab will be cleaned up on
			// the next call's `tab new` (the session's tab list
			// is bounded) or when the host process shuts down.
		}
	}

	/**
	 * Close the whole per-process browser session. Used on
	 * `provider.close()` and on `session_shutdown`.
	 */
	async close(): Promise<void> {
		try {
			await execAsync('agent-browser', ['close'], {
				env: sessionEnvFor(this),
			});
		} catch {
			// Ignore close errors.
		}
	}
}

/**
 * Simple async mutex for preventing concurrent browser access
 * within a single process. Two concurrent `webfetch` *processes*
 * do not need this (they each have their own
 * `AGENT_BROWSER_SESSION`); this only serialises the in-process
 * case.
 */
class BrowserMutex {
	private locked = false;
	private waitQueue: Array<() => void> = [];

	/**
	 * Acquire the lock. If already locked, waits until lock is released.
	 */
	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}

		// Queue this request
		return new Promise<void>((resolve) => {
			this.waitQueue.push(resolve);
		});
	}

	/**
	 * Release the lock and process next waiting request
	 */
	release(): void {
		if (this.waitQueue.length > 0) {
			// Process next in queue
			const next = this.waitQueue.shift();
			next!();
		} else {
			this.locked = false;
		}
	}
}
