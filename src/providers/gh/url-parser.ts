/**
 * GitHub URL Parser
 *
 * Parses and validates GitHub URLs to extract owner, repo, and resource type.
 */

import type { URLDetection } from "../types.js";

/**
 * Parsed GitHub URL result
 */
export interface ParsedGitHubUrl {
	owner: string;
	repo: string;
	type: "issue" | "pr" | "repo" | "tree" | "blob" | "unknown";
	number?: number;
	path?: string;
	ref?: string;
}

/**
 * Parse GitHub URL and extract owner/repo/number
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
			return null;
		}

		const parts = parsed.pathname.split("/").filter(Boolean);

		if (parts.length >= 2) {
			const owner = parts[0];
			const repo = parts[1];

			if (parts.length === 2) {
				return { owner, repo, type: "repo" };
			}

			if (parts.length >= 3) {
				if (parts[2] === "issues" && parts.length >= 4) {
					return { owner, repo, type: "issue", number: parseInt(parts[3], 10) };
				}
				if (parts[2] === "pull" && parts.length >= 4) {
					return { owner, repo, type: "pr", number: parseInt(parts[3], 10) };
				}
				if (parts[2] === "tree" && parts.length >= 4) {
					// /owner/repo/tree/{ref}/{path}
					const ref = parts[3];
					const path = parts.length > 4 ? parts.slice(4).join("/") : "";
					return { owner, repo, type: "tree", ref, path };
				}
				if (parts[2] === "blob" && parts.length >= 4) {
					// /owner/repo/blob/{ref}/{path}
					const ref = parts[3];
					const path = parts.length > 4 ? parts.slice(4).join("/") : "";
					return { owner, repo, type: "blob", ref, path };
				}
			}
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Detect URL characteristics for GitHub
 */
export function detectGitHubUrl(url: string): URLDetection {
	const parsed = new URL(url);
	const hostname = parsed.hostname.toLowerCase();

	// GitHub URLs
	const isGitHubHost = hostname === "github.com" || hostname === "www.github.com";
	const isGitHubRaw = hostname === "raw.githubusercontent.com";

	// Check if it's an issue, PR, or repo URL
	const parts = parsed.pathname.split("/").filter(Boolean);
	const isIssueLike =
		parts.length >= 3 && (parts[2] === "issues" || parts[2] === "pull");
	const isRepoView = isGitHubHost && parts.length >= 2;

	return {
		isGitHub: isGitHubHost || isGitHubRaw,
		isReddit: false,
		isLikelySPA: false,
		isLikelyBinary: isLikelyBinaryGitHubUrl(url),
	};
}

/**
 * Check if URL is likely binary for GitHub
 */
export function isLikelyBinaryGitHubUrl(url: string): boolean {
	const binaryExtensions = [
		".pdf",
		".zip",
		".png",
		".jpg",
		".jpeg",
		".gif",
		".webp",
		".mp3",
		".mp4",
		".avi",
		".mov",
		".exe",
		".dmg",
	];

	const urlLower = url.toLowerCase();
	return binaryExtensions.some((ext) => urlLower.includes(ext));
}

/**
 * Check if URL is a GitHub URL
 */
export function isGitHubUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname === "github.com" ||
			parsed.hostname === "www.github.com" ||
			parsed.hostname === "raw.githubusercontent.com"
		);
	} catch {
		return false;
	}
}
