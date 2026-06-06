/**
 * Static Fetch - raw content surfacing
 *
 * The research service writes the raw response (e.g. original HTML
 * from a static fetch) to `input_raw.<ext>` in the session work
 * dir, so the subagent can grep the original markup when the
 * markdown conversion drops something. These tests pin the
 * `rawContent` / `rawContentType` plumbing on `staticFetch`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const htmlResponse = `<!doctype html>
<html>
<head><title>Hi</title></head>
<body>
<main>
<h1>Header</h1>
<p>Body content</p>
</main>
</body>
</html>`;

const markdownResponse = `# Raw markdown

Some **bold** text.
`;

const plainResponse = `just plain text\nwith a few lines\n`;

function makeResponse(body: string, contentType: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'content-type': contentType },
	});
}

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
	fetchMock.mockReset();
});

describe('staticFetch - rawContent surfacing', () => {
	it('HTML responses populate rawContent with the original markup and rawContentType=text/html', async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(htmlResponse, 'text/html; charset=utf-8'));

		const { staticFetch } = await import('../extensions/services/static-fetch.js');
		const result = await staticFetch('https://example.com/page', fetch);

		expect(result.details.rawContent).toBe(htmlResponse);
		expect(result.details.rawContentType).toContain('text/html');
	});

	it('Markdown responses populate rawContent with the original markdown', async () => {
		fetchMock.mockResolvedValueOnce(
			makeResponse(markdownResponse, 'text/markdown; charset=utf-8'),
		);

		const { staticFetch } = await import('../extensions/services/static-fetch.js');
		const result = await staticFetch('https://example.com/doc.md', fetch);

		expect(result.details.rawContent).toBe(markdownResponse);
		expect(result.details.rawContentType).toContain('text/markdown');
	});

	it('Plain text responses populate rawContent with the original text', async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(plainResponse, 'text/plain; charset=utf-8'));

		const { staticFetch } = await import('../extensions/services/static-fetch.js');
		const result = await staticFetch('https://example.com/notes.txt', fetch);

		expect(result.details.rawContent).toBe(plainResponse);
		expect(result.details.rawContentType).toContain('text/plain');
	});

	it('Binary responses do NOT populate rawContent (no markdown analysis on binary)', async () => {
		const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		fetchMock.mockResolvedValueOnce(
			new Response(pngBytes, {
				status: 200,
				headers: { 'content-type': 'image/png' },
			}),
		);

		const { staticFetch } = await import('../extensions/services/static-fetch.js');
		const result = await staticFetch('https://example.com/image.png', fetch);

		expect(result.details.rawContent).toBeUndefined();
		expect(result.details.rawContentType).toBeUndefined();
	});

	it('rawContent is preserved when the content is truncated to MAX_MARKDOWN_SIZE', async () => {
		// Repeat the body many times so it exceeds the 100KB cap.
		const bigHtml = `<p>${'x'.repeat(200_000)}</p>`;
		fetchMock.mockResolvedValueOnce(makeResponse(bigHtml, 'text/html; charset=utf-8'));

		const { staticFetch } = await import('../extensions/services/static-fetch.js');
		const result = await staticFetch('https://example.com/big', fetch);

		// The processed `content` is truncated; the raw is the
		// un-truncated original (the subagent can decide what to
		// do with it; grep can still match).
		expect(result.details.rawContent).toBe(bigHtml);
		expect(result.details.truncated).toBe(true);
	});
});
