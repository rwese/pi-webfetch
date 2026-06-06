/**
 * Markdown un-escape tests
 *
 * Regression for review finding 5 (BXAE / M2): turndown /
 * cheerio emit `\[1\]` for literal `[1]` in source HTML,
 * which the Markdown spec says is unnecessary. Downstream
 * renderers (LLMs, previews) often show the backslashes as
 * literal characters, which makes footnote-style references
 * look like `\1\` or worse.
 *
 * The v0.9.0 fix: a `unescapeBrackets` post-processing step
 * strips `\[` / `\]` outside fenced code blocks, with
 * special-casing for image syntax (`\!\[alt\](url)`) so we
 * do not break valid images.
 */

import { describe, expect, it } from 'vitest';
import { unescapeBrackets } from '../extensions/markdown.js';

describe('unescapeBrackets', () => {
	it('un-escapes Wikipedia-style footnote brackets `\\[1\\]`', () => {
		expect(unescapeBrackets('See Markdown \\[1\\] for context.')).toBe(
			'See Markdown [1] for context.',
		);
	});

	it('un-escapes multiple footnote references in one paragraph', () => {
		expect(unescapeBrackets('Claims \\[1\\] and \\[2\\] are well supported.')).toBe(
			'Claims [1] and [2] are well supported.',
		);
	});

	it('un-escapes standalone `\\[` / `\\]` pairs (not preceded by `!`)', () => {
		expect(unescapeBrackets('Use \\[brackets\\] in source.')).toBe('Use [brackets] in source.');
		expect(unescapeBrackets('A \\[ B \\] C')).toBe('A [ B ] C');
	});

	it('does NOT un-escape image syntax `\\!\\[alt\\](url)`', () => {
		// The image line is the shape turndown produces for
		// inline images. We must not break it.
		const image = '![moon](https://example.com/moon.png)';
		const escaped = `Look at \\${image} here.`;
		expect(unescapeBrackets(escaped)).toBe(`Look at \\${image} here.`);
	});

	it('preserves `\\[` / `\\]` inside fenced code blocks', () => {
		const input = 'Prose \\[1\\] plus code:\n\n```\nfoo\\[bar\\]baz\n```\n\nMore \\[2\\].';
		const output = unescapeBrackets(input);
		expect(output).toContain('Prose [1]');
		expect(output).toContain('More [2]');
		// Code block contents are untouched.
		expect(output).toContain('foo\\[bar\\]baz');
	});

	it('handles a full-page fixture (mix of prose, code, images, footnotes)', () => {
		const input = [
			'# Markdown',
			'',
			'Markdown is a lightweight markup language \\[1\\].',
			'',
			'```md',
			'# Heading',
			'\\[1\\] footnote',
			'```',
			'',
			'See also \\[2\\].',
			'',
			'![logo](https://example.com/logo.png)',
		].join('\n');
		const out = unescapeBrackets(input);
		expect(out).toContain('lightweight markup language [1]');
		expect(out).toContain('See also [2]');
		// Code block contents survive.
		expect(out).toContain('\\[1\\] footnote');
		// Image line is intact.
		expect(out).toContain('![logo](https://example.com/logo.png)');
	});

	it('returns the input unchanged when there is nothing to un-escape', () => {
		const input = '# Plain\n\nNo escapes here at all.\n';
		expect(unescapeBrackets(input)).toBe(input);
	});

	it('handles empty input', () => {
		expect(unescapeBrackets('')).toBe('');
	});
});
