import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInputFiles } from '../extensions/utils/formatting.js';

describe('writeInputFiles', () => {
	let sessionId: string;
	let workDir: string;

	beforeEach(() => {
		// Use a per-test session id so we never collide across runs.
		sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		workDir = join(tmpdir(), 'pi-webfetch-research', sessionId);
	});

	afterEach(async () => {
		// Clean up the work dir we created. Best-effort.
		try {
			await rm(workDir, { recursive: true, force: true });
		} catch {
			// Ignore - the dir may not exist if the test failed early.
		}
	});

	it('writes input.md to a session-keyed work dir under the system temp dir', async () => {
		const markdown = '# Hello\n\nThis is the processed content.';
		const result = await writeInputFiles(sessionId, { content: markdown });

		expect(result.workDir).toBe(workDir);
		expect(result.inputFile).toBe(join(workDir, 'input.md'));
		expect(result.inputRawFile).toBeUndefined();
		expect(existsSync(result.inputFile)).toBe(true);

		const onDisk = await readFile(result.inputFile, 'utf-8');
		expect(onDisk).toBe(markdown);
	});

	it('writes input_raw.html for HTML raw content', async () => {
		const html = '<!doctype html><html><body><h1>Hi</h1></body></html>';
		const result = await writeInputFiles(sessionId, {
			content: '# Hi',
			rawContent: html,
			rawContentType: 'text/html',
		});

		expect(result.inputRawFile).toBe(join(workDir, 'input_raw.html'));
		expect(existsSync(result.inputRawFile!)).toBe(true);
		const onDisk = await readFile(result.inputRawFile!, 'utf-8');
		expect(onDisk).toBe(html);
	});

	it('writes input_raw.md for markdown raw content', async () => {
		const raw = '# original markdown';
		const result = await writeInputFiles(sessionId, {
			content: '# processed',
			rawContent: raw,
			rawContentType: 'text/markdown',
		});

		expect(result.inputRawFile).toBe(join(workDir, 'input_raw.md'));
	});

	it('writes input_raw.txt for plain text raw content', async () => {
		const result = await writeInputFiles(sessionId, {
			content: 'processed',
			rawContent: 'raw text',
			rawContentType: 'text/plain',
		});

		expect(result.inputRawFile).toBe(join(workDir, 'input_raw.txt'));
	});

	it('writes input_raw.json for JSON raw content', async () => {
		const result = await writeInputFiles(sessionId, {
			content: '{}',
			rawContent: '{"key":"value"}',
			rawContentType: 'application/json',
		});

		expect(result.inputRawFile).toBe(join(workDir, 'input_raw.json'));
	});

	it('falls back to input_raw.bin when no content type is known', async () => {
		const result = await writeInputFiles(sessionId, {
			content: 'processed',
			rawContent: 'whatever',
		});

		expect(result.inputRawFile).toBe(join(workDir, 'input_raw.bin'));
	});

	it('creates the work dir if it does not exist', async () => {
		// Pre-condition: dir does not exist.
		expect(existsSync(workDir)).toBe(false);

		await writeInputFiles(sessionId, { content: 'x' });

		expect(existsSync(workDir)).toBe(true);
		const files = await readdir(workDir);
		expect(files.sort()).toEqual(['input.md']);
	});

	it('overwrites existing files in the work dir on a repeat call', async () => {
		// Pre-create the work dir + an old input.md so we can prove
		// the second call overwrites both files (not just the new
		// ones).
		await mkdir(workDir, { recursive: true });
		await writeFile(join(workDir, 'input.md'), 'OLD', 'utf-8');
		await writeFile(join(workDir, 'input_raw.html'), 'OLD RAW', 'utf-8');

		await writeInputFiles(sessionId, {
			content: 'NEW',
			rawContent: 'NEW RAW',
			rawContentType: 'text/html',
		});

		expect(await readFile(join(workDir, 'input.md'), 'utf-8')).toBe('NEW');
		expect(await readFile(join(workDir, 'input_raw.html'), 'utf-8')).toBe('NEW RAW');
	});
});
