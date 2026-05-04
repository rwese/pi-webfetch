/**
 * Clawfetch Provider
 *
 * Uses clawfetch CLI for content extraction.
 * Provides: Playwright + Mozilla Readability + Turndown
 * Plus fast paths for GitHub, Reddit RSS, and FlareSolverr support.
 */

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
	detectUrl,
	parseOutput,
	ClawfetchMutex,
} from "./clawfetch-internal";

/**
 * Clawfetch provider using the clawfetch CLI
 */
export class ClawfetchProvider implements WebfetchProvider {
	readonly name = "clawfetch";
	readonly priority = 5; // Lower than default (tried second)

	readonly capabilities: ProviderCapabilities = {
		supportsSPA: true,
		supportsGitHubFastPath: true,
		supportsRedditRSS: true,
		supportsBotProtection: false, // Requires FlareSolverr externally
		returnsMetadata: true, // Returns rich metadata
	};

	/** Mutex to prevent concurrent clawfetch invocations */
	private mutex = new ClawfetchMutex();
	private clawfetchPath: string | null = null;

	/**
	 * Find clawfetch binary (async version)
	 */
	private async findClawfetchAsync(): Promise<string | null> {
		if (this.clawfetchPath) {
			return this.clawfetchPath;
		}

		// Check common locations
		const candidates = [
			"clawfetch", // In PATH
			"./node_modules/.bin/clawfetch", // Local install
			"/usr/local/bin/clawfetch",
			"/usr/bin/clawfetch",
		];

		for (const candidate of candidates) {
			try {
				await execAsync(candidate, ["--help"]);
				this.clawfetchPath = candidate;
				return candidate;
			} catch {
				// Try next candidate
			}
		}

		return null;
	}

	/**
	 * Check if clawfetch CLI is available
	 */
	async isAvailable(): Promise<boolean> {
		return (await this.findClawfetchAsync()) !== null;
	}

	/**
	 * Detect URL characteristics
	 */
	detectUrl(url: string): URLDetection {
		return detectUrl(url);
	}

	/**
	 * Main fetch implementation using clawfetch CLI - protected by mutex
	 */
	async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
		const clawfetch = await this.findClawfetchAsync();

		if (!clawfetch) {
			throw new ProviderError(
				"clawfetch not installed. Install with: npm install -g clawfetch",
				this.name,
			);
		}

		const timeout = config?.timeout || 60000;

		// Acquire mutex to prevent concurrent Playwright instances
		await this.mutex.acquire();

		try {
			const output = await this.execClawfetchAsync(clawfetch, url, timeout);
			return parseOutput(output, url);
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
			this.mutex.release();
		}
	}

	/**
	 * Execute clawfetch CLI (async version)
	 */
	private async execClawfetchAsync(
		clawfetch: string,
		url: string,
		timeout: number,
	): Promise<string> {
		try {
			const env: Record<string, string> = {};
			if (process.env.HTTP_PROXY) env.HTTP_PROXY = process.env.HTTP_PROXY;
			if (process.env.HTTPS_PROXY) env.HTTPS_PROXY = process.env.HTTPS_PROXY;

			return await execAsync(clawfetch, [url], {
				timeout: Math.floor(timeout / 1000),
				env: Object.keys(env).length > 0 ? env : undefined,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ProviderError(`clawfetch execution failed: ${message}`, this.name);
		}
	}

	/**
	 * Clean up resources (clawfetch handles its own cleanup)
	 */
	async close(): Promise<void> {
		// clawfetch is stateless, nothing to clean up
	}
}
