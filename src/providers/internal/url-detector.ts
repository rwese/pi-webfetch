/**
 * URL Detector
 *
 * URL detection utilities for the DefaultProvider.
 */

import type { URLDetection } from "../types.js";

/** Common binary file extensions */
export const BINARY_EXTENSIONS = [
	".pdf",
	".zip",
	".gz",
	".tar",
	".rar",
	".7z",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".ico",
	".webp",
	".svg",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".wmv",
	".flv",
	".webm",
	".exe",
	".dmg",
	".pkg",
	".deb",
	".rpm",
	".appimage",
	".ttf",
	".otf",
	".woff",
	".woff2",
	".eot",
];

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
 * Detect URL characteristics
 */
export function detectUrl(url: string): URLDetection {
	const hostname = new URL(url).hostname.toLowerCase();

	// GitHub URLs include both web interface and raw content URLs
	const isGitHubHost =
		hostname === "github.com" || hostname === "www.github.com" || hostname === "raw.githubusercontent.com";

	return {
		isGitHub: isGitHubHost,
		isReddit: hostname.includes(".reddit.com") || hostname === "reddit.com",
		isLikelySPA: isGitHubHost ? false : checkLikelySPA(url),
		isLikelyBinary: isLikelyBinaryUrl(url),
	};
}

/**
 * Check if URL likely points to binary content
 */
export function isLikelyBinaryUrl(url: string): boolean {
	const urlWithoutQuery = url.split(/[?#]/)[0].toLowerCase();
	return BINARY_EXTENSIONS.some((ext) => urlWithoutQuery.endsWith(ext));
}

/**
 * Check if URL is likely a SPA
 */
export function checkLikelySPA(url: string): boolean {
	const hostname = new URL(url).hostname.toLowerCase();
	return SPA_INDICATORS.some((indicator) => hostname.includes(indicator));
}
