/**
 * Clawfetch URL Detector
 * 
 * URL detection utilities for the ClawfetchProvider.
 */

import type { URLDetection } from "../types.js";
import { BINARY_EXTENSIONS } from "../../config/binary-types.js";

/** SPA indicator domains/patterns */
const SPA_INDICATORS = [
	"reddit.com",
	"twitter.com",
	"x.com",
	"notion.so",
	"figma.com",
	"google.com/mail",
	"mail.google",
];

/**
 * Detect URL characteristics for ClawfetchProvider
 */
export function detectUrl(url: string): URLDetection {
	const parsed = new URL(url);
	const hostname = parsed.hostname.toLowerCase();

	// GitHub URLs include both web interface and raw content URLs
	const isGitHubHost =
		hostname === "github.com" || hostname === "www.github.com" || hostname === "raw.githubusercontent.com";

	return {
		isGitHub: isGitHubHost,
		isReddit: hostname.includes(".reddit.com") || hostname === "reddit.com",
		isLikelySPA: isGitHubHost ? false : checkLikelySPA(url),
		isLikelyBinary: checkLikelyBinary(url),
	};
}

/**
 * Check if URL is likely a SPA
 */
export function checkLikelySPA(url: string): boolean {
	const hostname = new URL(url).hostname.toLowerCase();
	return SPA_INDICATORS.some((indicator) => hostname.includes(indicator));
}

/**
 * Check if URL is likely binary
 */
export function checkLikelyBinary(url: string): boolean {
	const urlLower = url.toLowerCase();
	return BINARY_EXTENSIONS.some((ext) => urlLower.includes(ext));
}
