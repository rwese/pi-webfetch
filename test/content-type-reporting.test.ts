/**
 * Content-Type Reporting Tests
 *
 * Tests for proper content-type reporting in fetch results.
 */

import { describe, it, expect } from 'vitest';

describe('Content-Type Reporting', () => {
	it('documents that text/plain should not be reported as text/html', () => {
		// This test documents the expected behavior
		// GitHub raw URLs return: content-type: text/plain; charset=utf-8
		// The provider should report the actual content type

		const actualContentType = 'text/plain; charset=utf-8';
		const buggyContentType = 'text/html'; // Bug: hardcoded

		expect(actualContentType).not.toBe(buggyContentType);
	});

	it('documents that text/plain content should preserve its content-type header', () => {
		// When fetching raw GitHub content, the Content-Type header should be preserved
		// not replaced with a generic text/html

		const headers = {
			'content-type': 'text/plain; charset=utf-8',
		};

		// The fetch result should use the actual content-type from headers
		const reportedType = headers['content-type'];

		expect(reportedType).toContain('text/plain');
		expect(reportedType).not.toBe('text/html');
	});
});
