/**
 * URL Utilities
 *
 * URL detection, parsing, and conversion helpers.
 */

/** Binary file extensions pattern */
const BINARY_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|mp3|wav|pdf|zip|tar|gz|rar|7z|doc|docx|xls|xlsx|ppt|pptx)$/i;

/**
 * Check if URL likely points to binary content
 */
export function isLikelyBinaryUrl(url: string): boolean {
	// Remove query string and fragment before checking extension
	const cleanUrl = url.split(/[?#]/)[0];
	return BINARY_EXTENSIONS.test(cleanUrl);
}

/**
 * Convert GitHub blob URL to raw URL
 */
export function convertGitHubToRaw(url: string): { rawUrl: string; isGitHubRaw: boolean } {
	// Already a raw.githubusercontent.com URL
	if (url.includes('raw.githubusercontent.com')) {
		return { rawUrl: url, isGitHubRaw: true };
	}

	const blobMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
	if (blobMatch) {
		const [, owner, repo, branch, path] = blobMatch;
		return {
			rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
			isGitHubRaw: true,
		};
	}
	return { rawUrl: url, isGitHubRaw: false };
}

/**
 * Parse URL for display (shorten if too long)
 */
export function parseUrlForDisplay(url: string, maxLength = 60): string {
	try {
		const parsed = new URL(url);
		const display = parsed.hostname + parsed.pathname;
		if (display.length > maxLength) {
			return display.slice(0, maxLength - 3) + '...';
		}
		return display;
	} catch {
		return url.length > maxLength ? url.slice(0, maxLength - 3) + '...' : url;
	}
}
