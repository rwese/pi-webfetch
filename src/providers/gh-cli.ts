/**
 * GitHub CLI Provider
 *
 * Uses the gh CLI for fetching GitHub content (issues, repos, etc.)
 * Falls back when no browser provider is available or as an alternative.
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
	parseGitHubUrl,
	detectGitHubUrl,
	isGitHubUrl,
} from "./gh/url-parser";
import {
	fetchByType,
	execGh,
} from "./gh/content-fetcher";

/**
 * GitHub CLI provider using the gh command
 */
export class GhCliProvider implements WebfetchProvider {
	readonly name = "gh-cli";
	readonly priority = 8; // Higher than clawfetch (5), lower than default (10)
	// But for GitHub URLs, it will be preferred in provider selection

	readonly capabilities: ProviderCapabilities = {
		supportsSPA: false, // Not applicable for gh CLI
		supportsGitHubFastPath: true,
		supportsRedditRSS: false,
		supportsBotProtection: false,
		returnsMetadata: true,
	};

	private ghPath: string | null = null;
	private authenticated: boolean | null = null;

	/**
	 * Find gh binary and check if authenticated (async version)
	 */
	private async findGhAsync(): Promise<string | null> {
		if (this.ghPath !== null) {
			return this.ghPath;
		}

		const candidates = [
			"gh", // In PATH
			"/usr/local/bin/gh",
			"/usr/bin/gh",
			"/opt/homebrew/bin/gh",
		];

		for (const candidate of candidates) {
			try {
				await execAsync(candidate, ["--version"]);
				this.ghPath = candidate;
				return candidate;
			} catch {
				// Try next candidate
			}
		}

		this.ghPath = null;
		return null;
	}

	/**
	 * Check if gh CLI is available and authenticated (async version)
	 */
	async isAvailable(): Promise<boolean> {
		const gh = await this.findGhAsync();
		if (!gh) {
			return false;
		}

		if (this.authenticated === null) {
			try {
				await execAsync(gh, ["auth", "status"]);
				this.authenticated = true;
			} catch {
				this.authenticated = false;
			}
		}

		return this.authenticated;
	}

	/**
	 * Detect URL characteristics
	 */
	detectUrl(url: string): URLDetection {
		return detectGitHubUrl(url);
	}

	/**
	 * Main fetch implementation using gh CLI
	 */
	async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
		const gh = await this.findGhAsync();

		if (!gh) {
			throw new ProviderError(
				"gh CLI not installed. Install from: https://cli.github.com",
				this.name,
			);
		}

		if (!this.authenticated) {
			throw new ProviderError(
				"gh CLI not authenticated. Run: gh auth login",
				this.name,
			);
		}

		const parsed = parseGitHubUrl(url);

		if (!parsed) {
			throw new ProviderError(`Could not parse GitHub URL: ${url}`, this.name);
		}

		const timeout = config?.timeout || 30000;

		try {
			return await fetchByType(gh, parsed, timeout);
		} catch (error) {
			if (error instanceof ProviderError) {
				throw error;
			}
			throw new ProviderError(
				error instanceof Error ? error.message : String(error),
				this.name,
				error instanceof Error ? error : undefined,
			);
		}
	}
}
