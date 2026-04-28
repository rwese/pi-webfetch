// Utility helper functions

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Generate a unique temp file path */
export function getTempFilePath(prefix: string, extension: string): string {
	const id = randomBytes(8).toString('hex');
	return join(tmpdir(), `${prefix}-${id}.${extension}`);
}

/** Format bytes to human readable string */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Truncate text to max size */
export function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, 'utf-8');
	if (bytes <= maxSize) return text;
	const buffer = Buffer.alloc(maxSize - 3);
	buffer.write(text, 0, 'utf-8');
	return buffer.toString('utf-8') + '...';
}

/** Check if URL likely points to binary content */
export function isLikelyBinaryUrl(url: string): boolean {
	// Remove query string and fragment before checking extension
	const cleanUrl = url.split(/[?#]/)[0];
	const binaryExtensions = /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|mp3|wav|pdf|zip|tar|gz|rar|7z|doc|docx|xls|xlsx|ppt|pptx)$/i;
	return binaryExtensions.test(cleanUrl);
}

/** Convert GitHub blob URL to raw URL */
export function convertGitHubToRaw(url: string): { rawUrl: string; isGitHubRaw: boolean } {
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
