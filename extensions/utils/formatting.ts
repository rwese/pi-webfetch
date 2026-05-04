/**
 * Formatting Utilities
 *
 * Text and data formatting helpers.
 */

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Generate a unique temp file path
 */
export function getTempFilePath(prefix: string, extension: string): string {
	const id = randomBytes(8).toString('hex');
	return join(tmpdir(), `${prefix}-${id}.${extension}`);
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate text to max byte size while preserving UTF-8 integrity
 */
export function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, 'utf-8');
	if (bytes <= maxSize) return text;
	const buffer = Buffer.alloc(maxSize - 3);
	buffer.write(text, 0, 'utf-8');
	return buffer.toString('utf-8') + '...';
}
