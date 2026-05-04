/**
 * Default Provider
 *
 * Uses agent-browser for rendering + cheerio for extraction + turndown for conversion.
 * This is the current/default implementation that provides browser-based fetching.
 */

import { load } from "cheerio";
import { execAsync } from "../utils/process.js";
import {
	type WebfetchProvider,
	type ProviderFetchResult,
	type ProviderCapabilities,
	type URLDetection,
	type ProviderConfig,
	ProviderError,
} from "./types";
import {
	BrowserManager,
	DEFAULT_BROWSER_IDLE_TIMEOUT,
	createTurndownService,
	extractTitle,
	cleanHtml,
	calculateTextRatio,
} from "./internal";
import { detectUrl } from "./internal/url-detector";

/**
 * Default provider using agent-browser + cheerio + turndown
 */
export class DefaultProvider implements WebfetchProvider {
	readonly name = "default";
	readonly priority = 10;

	/** Browser manager instance */
	private browser: BrowserManager;

	readonly capabilities: ProviderCapabilities = {
		supportsSPA: true,
		supportsGitHubFastPath: false, // Handled at higher level
		supportsRedditRSS: false,
		supportsBotProtection: false,
		returnsMetadata: false, // Only URL/status metadata
	};

	/**
	 * Create provider with configurable idle timeout
	 */
	constructor(idleTimeoutMs?: number) {
		this.browser = new BrowserManager(idleTimeoutMs ?? DEFAULT_BROWSER_IDLE_TIMEOUT);
	}

	/**
	 * Check if agent-browser CLI is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("agent-browser", ["--version"]);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Detect URL characteristics
	 */
	detectUrl(url: string): URLDetection {
		return detectUrl(url);
	}

	/**
	 * Main fetch implementation - protected by mutex to prevent race conditions
	 */
	async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
		const timeout = config?.timeout || 30000;
		const waitFor = config?.waitFor || "networkidle";

		// Check availability
		if (!(await this.isAvailable())) {
			throw new ProviderError(
				"agent-browser not installed. Install with: npm i -g agent-browser && agent-browser install",
				this.name,
			);
		}

		// Acquire mutex to prevent concurrent browser access
		await this.browser.acquire();

		try {
			// Extract HTML via browser
			const htmlResult = await this.browser.extractHtml(url, waitFor, timeout);

			if (!htmlResult.html) {
				throw new ProviderError("Failed to extract HTML from browser", this.name);
			}

			// Clean HTML and check text ratio
			const cleanedHtml = cleanHtml(htmlResult.html);
			const textRatio = calculateTextRatio(cleanedHtml);

			// If text ratio is too low, fallback to plain text
			let content: string;
			let extractionMethod: string;
			let reportedContentType: string;

			if (textRatio < 0.05) {
				// Fallback: get plain text from browser
				const textResult = await this.browser.extractText(url, waitFor, timeout);
				content = textResult;
				extractionMethod = "browser-text-fallback";
				// Low text ratio suggests plain text content (like raw GitHub files)
				reportedContentType = "text/plain";
			} else {
				// Convert HTML to markdown
				content = createTurndownService().turndown(cleanedHtml);
				extractionMethod =
					htmlResult.contentSource === "body"
						? "browser-html-body"
						: `browser-html-${htmlResult.contentSource}`;
				reportedContentType = "text/html";
			}

			return {
				content,
				metadata: {
					title: extractTitle(htmlResult.html),
				},
				finalUrl: url,
				status: 200,
				contentType: reportedContentType,
				extractionMethod,
				providerName: this.name,
				fallbackSelector: htmlResult.contentSource === "body" ? "body" : undefined,
			};
		} catch (error) {
			if (error instanceof ProviderError) {
				throw error;
			}
			throw new ProviderError(
				error instanceof Error ? error.message : String(error),
				this.name,
				error instanceof Error ? error : undefined,
			);
		} finally {
			// Always release the mutex
			this.browser.release();
		}
	}

	/**
	 * Clean up browser resources
	 */
	async close(): Promise<void> {
		await this.browser.close();
	}
}
