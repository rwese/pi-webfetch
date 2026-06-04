/**
 * Fetch Service - GitHub Hint Plumbing
 *
 * Verifies that when a provider returns a `metadata.githubHint`, the
 * fetch-service mirrors that string into `WebfetchDetails.githubHint` and
 * appends the hint tail to the final content. This is the path used by
 * the gh-cli provider when callers do not pass `includeComments: true`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the provider manager and cache so we can drive fetchUrl deterministically.
const fetchUrlMock = vi.fn();
const getProviderManagerMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/services/session-manager.js', () => ({
	getProviderManager: getProviderManagerMock,
	closeAllProviders: async () => undefined,
	closeAllSessionsProviders: async () => undefined,
	getProviderStatus: async () => [],
}));

function setDefaultProviderResult() {
	getProviderManagerMock.mockResolvedValue({
		fetch: async (url: string, config: unknown) => {
			fetchUrlMock(url, config);
			return {
				content: '# Title\n\nbody',
				contentType: 'text/markdown',
				status: 200,
				extractionMethod: 'gh-issue-view',
				providerName: 'gh-cli',
				metadata: {
					title: 'Title',
					author: 'octocat',
					githubHint:
						'> Tip: pass `includeComments: true` (CLI: `--include-comments`) to include issue comments and PR review threads.',
				},
			};
		},
		closeAll: async () => undefined,
	});
}

vi.mock('../extensions/services/cache-service.js', () => ({
	getCachedResult: async () => null,
	cacheFetchResult: async (result: unknown) => result,
	shouldSkipCache: () => false,
	buildCacheEntry: (r: unknown) => r,
}));

vi.mock('../extensions/services/static-fetch.js', () => ({
	staticFetch: async () => ({
		content: [{ type: 'text' as const, text: 'static' }],
		details: { url: '', contentType: null, status: 0, processedAs: 'fallback' as const },
	}),
	handleBinary: async () => ({
		content: [{ type: 'text' as const, text: 'binary' }],
		details: { url: '', contentType: null, status: 0, processedAs: 'binary' as const },
	}),
}));

vi.mock('../extensions/utils/url.js', () => ({
	isLikelyBinaryUrl: () => false,
}));

import { fetchUrl, webfetchSPA } from '../extensions/services/fetch-service.js';

beforeEach(() => {
	fetchUrlMock.mockReset();
	getProviderManagerMock.mockReset();
	setDefaultProviderResult();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchUrl + GitHub hint plumbing', () => {
	it('surfaces metadata.githubHint on details.githubHint', async () => {
		const result = await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: false } },
		);

		expect(result.details.githubHint).toContain('Tip');
		expect(result.details.githubHint).toContain('includeComments');
	});

	it('appends the in-content hint tail when the provider did not include it', async () => {
		const result = await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: false } },
		);
		const text = result.content[0]?.text ?? '';
		expect(text).toContain('# Title');
		expect(text).toContain('Tip:');
		// ensure details.githubHint equals the in-content tail
		expect(text).toContain(result.details.githubHint ?? '<<missing>>');
	});

	it('passes the github options through to manager.fetch', async () => {
		await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: true } },
		);
		const lastCall = fetchUrlMock.mock.calls.at(-1);
		const config = lastCall?.[1] as { github?: { includeComments?: boolean } } | undefined;
		expect(config?.github?.includeComments).toBe(true);
	});

	it('does not duplicate the hint tail when the provider already included it', async () => {
		// Override the mock to return content that already contains the hint tail.
		getProviderManagerMock.mockResolvedValueOnce({
			fetch: async () => ({
				content:
					'# Title\n\nbody\n\n> Tip: pass `includeComments: true` (CLI: `--include-comments`) to include issue comments and PR review threads.',
				contentType: 'text/markdown',
				status: 200,
				extractionMethod: 'gh-issue-view',
				providerName: 'gh-cli',
				metadata: {
					title: 'Title',
					author: 'octocat',
					githubHint:
						'> Tip: pass `includeComments: true` (CLI: `--include-comments`) to include issue comments and PR review threads.',
				},
			}),
			closeAll: async () => undefined,
		});

		const result = await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: false } },
		);
		const text = result.content[0]?.text ?? '';
		const occurrences = (text.match(/Tip: pass/g) ?? []).length;
		expect(occurrences).toBe(1);
		expect(result.details.githubHint).toBeDefined();
	});
});

describe('webfetchSPA + GitHub hint plumbing', () => {
	it('surfaces metadata.githubHint on details.githubHint', async () => {
		const result = await webfetchSPA(
			'https://github.com/foo/bar/issues/1',
			'networkidle',
			30000,
			{ github: { includeComments: false } },
		);

		expect(result.details.githubHint).toContain('Tip');
	});
});
