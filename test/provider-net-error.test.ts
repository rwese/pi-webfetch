/**
 * Provider net-error tests
 *
 * Regression for BUG-2026-06-06-JGCMZSNR-YZOYE: when the
 * browser provider navigates to a URL that fails DNS
 * resolution (`does-not-exist.invalid`), Chromium renders
 * its own net-error page and `agent-browser get text body`
 * returns that page as plain text. The default provider
 * then classified the result as a `low text ratio`
 * plain-text document, set `Status: 200, Content-Type:
 * text/plain, Method: browser-text-fallback`, and returned
 * the error message as the page content.
 *
 * The fix scans the rendered body for known Chromium
 * net-error strings (`ERR_NAME_NOT_RESOLVED`,
 * `ERR_CONNECTION_REFUSED`, etc.) and throws a
 * `ProviderError` with `reason: 'navigation_failed'` so
 * the fetch service falls back to static fetch (which
 * produces the documented `Status: 0 + TypeError` contract).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/process.js', () => ({
	execAsync: execAsyncMock,
	execAsyncFull: vi.fn(),
	ProcessMutex: class {},
	killProcessTree: vi.fn(),
	ExecAsyncError: class extends Error {},
}));

import { DefaultProvider, detectChromiumNetError } from '../src/providers/default.js';
import { ProviderError } from '../src/providers/types.js';

beforeEach(() => {
	execAsyncMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('detectChromiumNetError (unit)', () => {
	it('returns the matched error code for ERR_NAME_NOT_RESOLVED', () => {
		const body = 'This site can’t be reached\nERR_NAME_NOT_RESOLVED';
		expect(detectChromiumNetError(body)).toBe('ERR_NAME_NOT_RESOLVED');
	});

	it('returns the matched error code for ERR_CONNECTION_REFUSED', () => {
		const body = '<html><body>ERR_CONNECTION_REFUSED</body></html>';
		expect(detectChromiumNetError(body)).toBe('ERR_CONNECTION_REFUSED');
	});

	it('returns the matched error code for ERR_SSL_PROTOCOL_ERROR', () => {
		const body = 'SSL error\nERR_SSL_PROTOCOL_ERROR';
		expect(detectChromiumNetError(body)).toBe('ERR_SSL_PROTOCOL_ERROR');
	});

	it('returns undefined for a body without a Chromium net-error string', () => {
		const body = '<html><body>Real page content</body></html>';
		expect(detectChromiumNetError(body)).toBeUndefined();
	});

	it('returns undefined for an empty body', () => {
		expect(detectChromiumNetError('')).toBeUndefined();
		expect(detectChromiumNetError(undefined)).toBeUndefined();
	});

	it('does NOT false-positive on a literal "ERR_" in real content', () => {
		// A real page that mentions the literal text "ERR_"
		// (e.g. a documentation page about Chromium errors)
		// must not be misclassified. Only the documented
		// `ERR_<NAME>` codes in the constant list match.
		const body = 'See the ERR_ namespace in the Chromium source for the full list of codes.';
		expect(detectChromiumNetError(body)).toBeUndefined();
	});
});

describe('DefaultProvider — Chromium net-error page', () => {
	const chromiumErrorPage = `
		<html>
			<body>
				<div class="net-error-page">
					<h1>This site can’t be reached</h1>
					<p>does-not-exist.invalid’s server IP address could not be found.</p>
					<p>ERR_NAME_NOT_RESOLVED</p>
				</div>
			</body>
		</html>
	`;

	it('throws `ProviderError` with `reason: "navigation_failed"` when the body contains ERR_NAME_NOT_RESOLVED', async () => {
		// The default provider's `extractHtml` calls
		// `agent-browser get html body`; the body comes back
		// as the Chromium error page. The default provider
		// scans the body, finds the net-error string, and
		// throws a `ProviderError`.
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'body') {
					return chromiumErrorPage;
				}
				return '';
			},
		);

		const provider = new DefaultProvider({ sessionName: 'test:42' });

		try {
			await expect(
				provider.fetch('https://does-not-exist.invalid'),
			).rejects.toThrow(ProviderError);

			await expect(
				provider.fetch('https://does-not-exist.invalid'),
			).rejects.toMatchObject({
				providerName: 'default',
				reason: 'navigation_failed',
			});
		} finally {
			await provider.close();
		}
	});

	it('does NOT throw on a real page (no net-error string in body)', async () => {
		// Pad the body so the text ratio is comfortably
		// above the 0.05 threshold; the default provider
		// takes the cheerio+turndown path, not the text
		// fallback.
		//
		// We use a wikitable so the turndown rule
		// (the only path exercised by the v0.9.0 default
		// provider in vitest+happy-dom — turndown's
		// browser-parser integration with happy-dom is
		// fragile on a plain `<p>`) still emits markdown.
		// The wikitable rule is covered by
		// `test/table-wikitables.test.ts`; this test
		// only asserts that the net-error scan does NOT
		// fire on a real page.
		const bodyText = 'Real content here. '.repeat(20);
		const realPage = `
			<table class="wikitable">
				<thead><tr><th>Col1</th><th>Col2</th></tr></thead>
				<tbody><tr><td>${bodyText}</td><td>${bodyText}</td></tr></tbody>
			</table>
		`;
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'body') {
					return realPage;
				}
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'article') {
					return realPage;
				}
				return '';
			},
		);

		const provider = new DefaultProvider({ sessionName: 'test:42' });

		try {
			const result = await provider.fetch('https://example.com');
			// The provider did NOT throw. Status is 200
			// (the default successful path). The body
			// content is whatever the wikitable rule
			// produced; we don't pin the exact markdown
			// here — the wikitable rule has its own
			// test suite.
			expect(result.status).toBe(200);
		} finally {
			await provider.close();
		}
	});

	it('scans the text-fallback path too (low text ratio on a Chromium error page)', async () => {
		// When the text ratio is below 0.05, the default
		// provider falls back to `extractText`. The text
		// path is also scanned for net-error strings.
		const chromiumShortBody = '<html><body>ERR_NAME_NOT_RESOLVED</body></html>';
		const chromiumShortText = 'This site can’t be reached\nERR_NAME_NOT_RESOLVED';
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'body') {
					return chromiumShortBody;
				}
				if (args[0] === 'get' && args[1] === 'text' && args[2] === 'body') {
					return chromiumShortText;
				}
				return '';
			},
		);

		const provider = new DefaultProvider({ sessionName: 'test:42' });

		try {
			await expect(
				provider.fetch('https://does-not-exist.invalid'),
			).rejects.toMatchObject({
				providerName: 'default',
				reason: 'navigation_failed',
			});
		} finally {
			await provider.close();
		}
	});
});
