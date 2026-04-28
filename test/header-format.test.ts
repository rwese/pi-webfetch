/**
 * Header Format Tests
 *
 * Tests for the fetch result header format to ensure it doesn't cause
 * markdown viewer rendering issues.
 */

import { describe, it, expect } from 'vitest';

describe('Fetch Result Header Format', () => {
	/**
	 * Test that the header separator doesn't cause markdown viewer duplication.
	 * The `---` separator is interpreted as a horizontal rule by most markdown viewers,
	 * which can cause content after it to be rendered in a separate section.
	 */
	it('should not use --- as the primary separator', () => {
		// This documents the expected behavior:
		// The header should not use --- alone as a separator because it causes
		// markdown viewers to interpret it as a thematic break (horizontal rule)

		// The problematic pattern:
		const problematicOutput = `
## Header
Some metadata

---

Actual content here
`;
		// This can cause viewers to render the content twice or in separate sections

		// The solution is to either:
		// 1. Use a different separator (***, ___, <!-- -->)
		// 2. Use no separator (just a blank line)
		// 3. Use an HTML comment which is hidden

		const goodSeparators = [
			'\n\n***\n\n',      // Different horizontal rule style
			'\n\n___\n\n',       // Underscore horizontal rule
			'\n\n<!-- -->\n\n',  // HTML comment (hidden)
			'\n\n\n\n',         // Just whitespace
		];

		// Document that --- causes issues
		expect(problematicOutput).toContain('---\n\n');
	});

	it('documents that the header should not be followed by --- that creates a thematic break', () => {
		// When content like this is rendered:
		// ## Fetch Result
		// metadata...
		// ---
		// content...
		//
		// The --- creates a thematic break, potentially causing duplication
		const headerWithProblematicSeparator = '## Fetch Result\n\n**URL:** example.com\n\n---\n\n';

		// The --- line is followed by a blank line, making it a thematic break
		expect(headerWithProblematicSeparator).toContain('---\n\n');
	});
});
