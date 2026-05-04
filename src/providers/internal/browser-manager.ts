/**
 * Browser Manager
 *
 * Manages browser lifecycle for the DefaultProvider.
 */

import { execAsync } from "../../utils/process.js";

/** Default browser idle timeout in ms (5 minutes) */
export const DEFAULT_BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000;

/**
 * Result from HTML extraction
 */
export interface HtmlExtractionResult {
	html: string;
	contentSource: string;
}

/**
 * Browser manager for handling browser state and operations
 */
export class BrowserManager {
	private browserOpen = false;
	private currentUrl: string | null = null;
	private closeTimer: NodeJS.Timeout | null = null;

	/** Configurable idle timeout */
	private idleTimeout: number;

	/** Mutex to prevent concurrent browser access */
	private browserMutex = new BrowserMutex();

	constructor(idleTimeoutMs?: number) {
		this.idleTimeout = idleTimeoutMs ?? DEFAULT_BROWSER_IDLE_TIMEOUT;
	}

	/**
	 * Check if browser is currently open
	 */
	isOpen(): boolean {
		return this.browserOpen;
	}

	/**
	 * Get current URL in browser
	 */
	getCurrentUrl(): string | null {
		return this.currentUrl;
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
	 * Extract HTML from browser using agent-browser
	 */
	async extractHtml(
		url: string,
		waitFor: string,
		timeout: number,
	): Promise<HtmlExtractionResult> {
		let html = "";
		let contentSource = "body";

		// Open URL or navigate if browser already open
		if (!this.browserOpen) {
			await execAsync("agent-browser", ["open", url], { timeout });
			this.browserOpen = true;
		} else if (this.currentUrl !== url) {
			// Navigate to new URL if different
			await execAsync("agent-browser", ["open", url], { timeout });
		}
		this.currentUrl = url;

		// Wait for load
		await execAsync("agent-browser", ["wait", "--load", waitFor], { timeout });

		// Reset idle timer on successful navigation
		this.resetCloseTimer();

		// Try article first
		try {
			const articleHtml = await execAsync(
				"agent-browser",
				["get", "html", "article"],
				{ timeout: 5000 },
			);
			if (articleHtml && articleHtml.trim().length > 100) {
				html = articleHtml;
				contentSource = "article";
			}
		} catch {
			// Continue
		}

		// Try main
		if (!html) {
			try {
				const mainHtml = await execAsync(
					"agent-browser",
					["get", "html", "main"],
					{ timeout: 5000 },
				);
				if (mainHtml && mainHtml.trim().length > 100) {
					html = mainHtml;
					contentSource = "main";
				}
			} catch {
				// Continue
			}
		}

		// Fallback to body
		if (!html || html.trim().length < 100) {
			const bodyHtml = await execAsync("agent-browser", ["get", "html", "body"], { timeout });
			html = bodyHtml;
			contentSource = "body";
		}

		return { html, contentSource };
	}

	/**
	 * Extract plain text from browser
	 */
	async extractText(url: string, waitFor: string, timeout: number): Promise<string> {
		// Open URL or navigate if browser already open
		if (!this.browserOpen) {
			await execAsync("agent-browser", ["open", url], { timeout });
			this.browserOpen = true;
		} else if (this.currentUrl !== url) {
			await execAsync("agent-browser", ["open", url], { timeout });
		}
		this.currentUrl = url;

		// Wait for load
		await execAsync("agent-browser", ["wait", "--load", waitFor], { timeout });

		// Get text from body
		const bodyText = await execAsync("agent-browser", ["get", "text", "body"], { timeout });

		// Reset idle timer
		this.resetCloseTimer();

		return bodyText;
	}

	/**
	 * Reset the idle close timer
	 */
	private resetCloseTimer(): void {
		if (this.closeTimer) {
			clearTimeout(this.closeTimer);
		}
		this.closeTimer = setTimeout(() => {
			this.safeClose();
		}, this.idleTimeout);
	}

	/**
	 * Safely close browser - used in finally blocks
	 */
	async safeClose(): Promise<void> {
		if (this.closeTimer) {
			clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
		if (this.browserOpen) {
			try {
				await execAsync("agent-browser", ["close"]);
			} catch {
				// Ignore close errors
			}
			this.browserOpen = false;
			this.currentUrl = null;
		}
	}

	/**
	 * Close browser and clean up resources
	 */
	async close(): Promise<void> {
		await this.safeClose();
	}
}

/**
 * Simple async mutex for preventing concurrent browser access
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
