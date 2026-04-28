// Content type detection utilities

import { execSync } from 'node:child_process';

/** Check if agent-browser is available */
export function isBrowserAvailable(): boolean {
	try {
		execSync('agent-browser --version', { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** Check if content type is text convertible */
export function isTextContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const textTypes = [
		'text/html',
		'text/plain',
		'text/markdown',
		'text/xml',
		'application/xml',
		'application/json',
		'application/javascript',
		'application/x-javascript',
	];
	return textTypes.some((type) => contentType.includes(type));
}

/** Check if content type is binary */
export function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return true; // Unknown = binary for safety
	const binaryTypes = [
		'image/',
		'audio/',
		'video/',
		'application/octet-stream',
		'application/pdf',
		'application/zip',
		'application/gzip',
	];
	if (binaryTypes.some((type) => contentType.includes(type))) return true;
	// Application types that are not text
	if (contentType.startsWith('application/')) {
		const textAppTypes = ['application/json', 'application/xml', 'application/javascript'];
		return !textAppTypes.some((type) => contentType.includes(type));
	}
	return false;
}

/** Get file extension from content type, fallback to URL extension */
export function getExtensionFromContentType(contentType: string | null, url: string): string {
	if (contentType) {
		const mapping: Record<string, string> = {
			'text/html': 'html',
			'text/plain': 'txt',
			'text/markdown': 'md',
			'text/xml': 'xml',
			'application/json': 'json',
			'application/pdf': 'pdf',
			'image/png': 'png',
			'image/jpeg': 'jpg',
			'image/gif': 'gif',
			'image/webp': 'webp',
			'image/svg+xml': 'svg',
		};
		for (const [type, ext] of Object.entries(mapping)) {
			if (contentType.includes(type)) return ext;
		}
	}

	// Fallback to URL extension
	const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
	if (urlMatch) return urlMatch[1].toLowerCase();

	return 'bin';
}
