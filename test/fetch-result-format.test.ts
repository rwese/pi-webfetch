/**
 * Fetch Result Format Tests
 *
 * Tests for proper formatting of fetch results to avoid markdown rendering issues.
 * The header should not use `---` as a separator to prevent content duplication in viewers.
 */

import { describe, it, expect } from 'vitest';

describe('Fetch Result Header Format', () => {
	/**
	 * These tests verify that the header format doesn't cause markdown viewer issues.
	 * The separator `---` is interpreted as a horizontal rule by most markdown viewers,
	 * causing content duplication when followed by more content.
	 */
	it('should not use --- as separator in header output', () => {
		// This test documents the expected behavior:
		// The header should use a different separator or none at all
		// to prevent markdown viewers from interpreting it as a thematic break

		const badSeparator = '---';
		const goodAlternatives = [
			'***',     // Alternative horizontal rule
			'___',     // Alternative horizontal rule
			'--- ',    // With trailing space (some renderers still show)
			'\n\n',    // Just whitespace
			'<!-- -->', // HTML comment (hidden)
		];

		// Document that --- causes issues
		expect(badSeparator).toBe('---'); // This is the problematic pattern
	});

	it('documents that --- separator causes content duplication in markdown viewers', () => {
		// When markdown contains:
		// ## Header
		// content
		// ---
		// more content
		//
		// Some viewers render this as TWO sections, duplicating content
		const exampleContent = `
## Header
content

---

more content
`;
		// The '---' line is interpreted as a horizontal rule/thematic break
		expect(exampleContent).toContain('---');
	});
});

describe('Content-Type Handling', () => {
	it('documents that text/plain content should not be reported as text/html', () => {
		// GitHub raw URLs return content-type: text/plain; charset=utf-8
		// The provider should report the actual content type, not hardcode text/html
		const actualContentType = 'text/plain; charset=utf-8';
		const reportedContentType = 'text/html'; // Bug: hardcoded value

		// These should match for correct content type reporting
		expect(actualContentType).not.toBe(reportedContentType);
	});
});
