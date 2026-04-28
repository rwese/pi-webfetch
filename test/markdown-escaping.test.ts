/**
 * Markdown Escaping Tests
 *
 * Tests for turndown HTML-to-Markdown conversion to ensure special characters
 * are not incorrectly escaped in code blocks.
 */

import { describe, it, expect } from 'vitest';
import { convertToMarkdown } from '../extensions/html';

describe('convertToMarkdown', () => {
	describe('Code block character preservation', () => {
		it('preserves square brackets in code blocks', () => {
			const html = '<pre><code>[[:xdigit:]]{8}</code></pre>';
			const markdown = convertToMarkdown(html);
			// Square brackets in regex patterns should not be escaped
			expect(markdown).toContain('[[:xdigit:]]{8}');
			expect(markdown).not.toContain('\\[\\[:xdigit:\\]\\]');
		});

		it('preserves escaped brackets in code blocks', () => {
			const html = '<pre><code>\\[\\]</code></pre>';
			const markdown = convertToMarkdown(html);
			// The actual escaped characters should be preserved
			expect(markdown).toContain('\\[');
		});

		it('preserves backslashes in code blocks', () => {
			const html = '<pre><code>\\n\\t</code></pre>';
			const markdown = convertToMarkdown(html);
			// Backslashes should be preserved
			expect(markdown).toContain('\\n');
		});

		it('preserves regex patterns in code blocks', () => {
			const html = '<pre><code>\\[[A-Z]\\]</code></pre>';
			const markdown = convertToMarkdown(html);
			// Regex escape sequences should be preserved
			expect(markdown).toContain('\\[');
			expect(markdown).toContain('[A-Z]');
		});

		it('preserves Nix string patterns in code blocks', () => {
			const html = '<pre><code>\'\'${variable}</code></pre>';
			const markdown = convertToMarkdown(html);
			// Nix string interpolation patterns should be preserved
			expect(markdown).toContain('\'\'');
			expect(markdown).toContain('${variable}');
		});
	});

	describe('Inline code character preservation', () => {
		it('preserves square brackets in inline code', () => {
			const html = '<p>Use <code>[[:xdigit:]]</code> pattern</p>';
			const markdown = convertToMarkdown(html);
			// Square brackets should not be escaped in inline code
			expect(markdown).toContain('`[[:xdigit:]]`');
			expect(markdown).not.toContain('`\\[\\[');
		});
	});
});
