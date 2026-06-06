/**
 * Formatting Utilities
 *
 * Text and data formatting helpers.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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

/**
 * Options for {@link writeInputFiles}.
 *
 * - `content` (required): the processed markdown to save as `input.md`.
 * - `rawContent` (optional): the original un-processed response to save
 *   alongside. Extension is derived from `rawContentType`; defaults to
 *   `.txt` when no content type is known.
 * - `rawContentType` (optional): MIME type hint for `rawContent`,
 *   used to pick the `input_raw.<ext>` extension.
 */
export interface WriteInputFilesOptions {
	content: string;
	rawContent?: string;
	rawContentType?: string | null;
}

/**
 * Paths to the files written by {@link writeInputFiles}.
 *
 * - `inputFile`: absolute path to `input.md` (always written).
 * - `inputRawFile`: absolute path to `input_raw.<ext>`. `undefined`
 *   when no raw content was provided.
 * - `workDir`: absolute path to the session work dir.
 */
export interface ResearchInputFiles {
	inputFile: string;
	inputRawFile?: string;
	workDir: string;
}

/**
 * Pick a file extension for `input_raw` based on the content type.
 * Returns `.html` for HTML-ish types, `.json` for JSON, `.txt`
 * for text, `.md` for markdown, and `.bin` as a fallback.
 */
function pickRawExtension(rawContentType?: string | null): string {
	const type = (rawContentType ?? '').toLowerCase();
	if (type.includes('html')) return 'html';
	if (type.includes('json')) return 'json';
	if (type.includes('markdown')) return 'md';
	if (type.startsWith('text/')) return 'txt';
	return 'bin';
}

/**
 * Write the research subagent's input files to a session-keyed
 * work dir under the system temp dir, and return the absolute paths.
 *
 * Layout:
 *
 *   <tmpdir>/pi-webfetch-research/<sessionId>/input.md
 *   <tmpdir>/pi-webfetch-research/<sessionId>/input_raw.<ext>  (optional)
 *
 * The dir is created with `recursive: true` if missing, so concurrent
 * invocations (different session ids) are safe. The session id is the
 * deterministic subagent id from `deriveSessionId`, so the resumed
 * subagent (via `pi --session <id>`) can locate the same files
 * without re-fetching.
 *
 * The function is best-effort: a write failure is propagated so the
 * caller can decide between a hard fail and a graceful fallback.
 */
export async function writeInputFiles(
	sessionId: string,
	options: WriteInputFilesOptions,
): Promise<ResearchInputFiles> {
	const workDir = join(tmpdir(), 'pi-webfetch-research', sessionId);
	await mkdir(workDir, { recursive: true });

	const inputFile = join(workDir, 'input.md');
	await writeFile(inputFile, options.content, 'utf-8');

	let inputRawFile: string | undefined;
	if (options.rawContent) {
		const ext = pickRawExtension(options.rawContentType);
		inputRawFile = join(workDir, `input_raw.${ext}`);
		await writeFile(inputRawFile, options.rawContent, 'utf-8');
	}

	return { inputFile, inputRawFile, workDir };
}
