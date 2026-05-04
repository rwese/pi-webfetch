/**
 * Binary Type Configuration
 *
 * Centralized configuration for binary file type detection.
 * Shared across all providers.
 */

/** Binary file extensions */
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
] as const;

/** Type for binary extensions */
export type BinaryExtension = (typeof BINARY_EXTENSIONS)[number];

/**
 * Check if a URL likely points to binary content
 */
export function isLikelyBinaryUrl(url: string): boolean {
	const urlWithoutQuery = url.split(/[?#]/)[0].toLowerCase();
	return BINARY_EXTENSIONS.some((ext) => urlWithoutQuery.endsWith(ext));
}

/**
 * Check if a file extension is binary
 */
export function isBinaryExtension(extension: string): boolean {
	const ext = extension.startsWith(".") ? extension : `.${extension}`;
	return BINARY_EXTENSIONS.includes(ext as BinaryExtension);
}

/**
 * Get binary extensions as a Set for efficient lookup
 */
export function getBinaryExtensionsSet(): Set<string> {
	return new Set(BINARY_EXTENSIONS);
}
