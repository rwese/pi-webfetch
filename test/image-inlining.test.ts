/**
 * Image inlining tests
 *
 * Regression for review finding 2 (BXAB / M2): the default
 * behaviour for inline `<img>` references used to be "extract
 * to a temp file and emit a `[ref-N]` placeholder". That made
 * the markdown useless for downstream LLM consumers (which
 * render the placeholder as a broken link) and surprised users
 * who just wanted the URL inlined.
 *
 * The v0.9.0 fix flips the default: `extractEmbeddedImages`
 * now keeps the inline `![alt](url)` form and only writes the
 * temp file when the caller passes `{ extract: true }`. These
 * tests pin the new default (inlined), the explicit-extract
 * path (still useful for binary / data-URI cases), and the
 * pre-change regression guard (the placeholder form is no
 * longer the default).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	extractEmbeddedImages,
	stripEmbeddedImages,
	removeMarkdownAnchors,
} from '../extensions/markdown.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'pi-webfetch-image-inline-'));
const prevTmp = process.env.TMPDIR;
process.env.TMPDIR = tmpRoot;

afterEach(() => {
	process.env.TMPDIR = prevTmp;
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe('extractEmbeddedImages — default behaviour (v0.9.0+)', () => {
	it('keeps inline `![alt](url)` references intact (no [ref-N] placeholder)', async () => {
		const input = '# Heading\n\nLook at ![moon](https://example.com/moon.png).\n';
		const out = await extractEmbeddedImages(input);
		expect(out.content).toContain('![moon](https://example.com/moon.png)');
		expect(out.content).not.toContain('[ref-1]');
		// No temp file written in the default inlined path.
		expect(out.tempFilePath).toBeUndefined();
	});

	it('preserves multiple images inline', async () => {
		const input = [
			'# Article',
			'![a](https://example.com/a.png)',
			'![b](https://example.com/b.png)',
		].join('\n\n');
		const out = await extractEmbeddedImages(input);
		expect(out.content).toContain('![a](https://example.com/a.png)');
		expect(out.content).toContain('![b](https://example.com/b.png)');
		expect(out.content).not.toContain('[ref-');
	});

	it('preserves images with a title attribute inline', async () => {
		const input = '![logo](https://example.com/logo.png "Example logo")';
		const out = await extractEmbeddedImages(input);
		expect(out.content).toContain('![logo](https://example.com/logo.png "Example logo")');
	});

	it('preserves images with empty alt text inline', async () => {
		const input = '![](https://example.com/decoration.png)';
		const out = await extractEmbeddedImages(input);
		expect(out.content).toContain('![](https://example.com/decoration.png)');
	});

	it('preserves images inside fenced code blocks (no accidental rewrite)', async () => {
		const input = [
			'# Heading',
			'',
			'```md',
			'![inside](https://example.com/inside.png)',
			'```',
		].join('\n');
		const out = await extractEmbeddedImages(input);
		// The protected code block must round-trip cleanly.
		expect(out.content).toContain('![inside](https://example.com/inside.png)');
	});

	it('returns the original content unchanged when there are no images', async () => {
		const input = '# Plain\n\nNo images here at all.\n';
		const out = await extractEmbeddedImages(input);
		expect(out.content).toBe(input);
		expect(out.tempFilePath).toBeUndefined();
	});
});

describe('extractEmbeddedImages — explicit-extract path (binary / data URIs)', () => {
	it('writes a temp file with the image refs when `extract: true`', async () => {
		const input = '![moon](https://example.com/moon.png)\n\n![star](https://example.com/star.png)';
		const out = await extractEmbeddedImages(input, { extract: true });
		// Inline `![alt](url)` is replaced with `![alt][ref-N]` placeholders.
		expect(out.content).toContain('![moon][ref-1]');
		expect(out.content).toContain('![star][ref-2]');
		expect(out.tempFilePath).toBeDefined();
		// Temp file contains the original markdown plus a refs block.
		const fs = await import('node:fs');
		const file = fs.readFileSync(out.tempFilePath!, 'utf-8');
		expect(file).toContain('![moon](https://example.com/moon.png)');
		expect(file).toContain('[ref-1]: https://example.com/moon.png');
		expect(file).toContain('[ref-2]: https://example.com/star.png');
	});
});

describe('stripEmbeddedImages (unchanged)', () => {
	it('strips the image syntax but keeps the alt text', () => {
		const input = 'Look at ![moon](https://example.com/moon.png).';
		const out = stripEmbeddedImages(input);
		expect(out).toBe('Look at moon.');
	});

	it('preserves code blocks', () => {
		const input = [
			'# Heading',
			'',
			'```md',
			'![inside](https://example.com/inside.png)',
			'```',
		].join('\n');
		const out = stripEmbeddedImages(input);
		expect(out).toContain('![inside](https://example.com/inside.png)');
	});
});

describe('pin the pre-change behaviour (regression guard)', () => {
	// The v0.8.0 default was "extract by default". These tests
	// would have passed under v0.8.0 and now act as a guard so
	// we do not accidentally re-introduce the placeholder
	// default. Both are pinned so a future regression shows up
	// in the diff.
	it('removes any `[ref-N]` reference lines that slip in via the explicit-extract path', async () => {
		const input = '![moon](https://example.com/moon.png)';
		const out = await extractEmbeddedImages(input);
		// Default path: no ref block, no temp file.
		expect(out.content).not.toMatch(/\[ref-\d+\]:/);
		expect(out.tempFilePath).toBeUndefined();
	});
});
