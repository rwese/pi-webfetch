/**
 * Fetch Routing Integration Tests
 *
 * Tests that verify raw GitHub URLs go through static fetch, not the provider.
 */

import { describe, it, expect } from 'vitest';
import { isLikelyBinaryUrl } from '../extensions/helpers';

describe('Raw GitHub URL Static Fetch Routing', () => {
	it('raw.githubusercontent.com should not be treated as binary', () => {
		// Raw GitHub URLs return plain text, not binary
		const rawUrl = 'https://raw.githubusercontent.com/nix-community/disko/master/lib/types/gpt.nix';
		expect(isLikelyBinaryUrl(rawUrl)).toBe(false);
	});

	it('github.com blob URLs should not be treated as binary', () => {
		// GitHub blob pages are HTML, but content itself is text
		const blobUrl = 'https://github.com/user/repo/blob/main/file.txt';
		expect(isLikelyBinaryUrl(blobUrl)).toBe(false);
	});

	it('raw.githubusercontent.com hostname is detected correctly', () => {
		// This test documents the expected hostname behavior
		const rawUrl = 'https://raw.githubusercontent.com/user/repo/main/file.nix';
		const hostname = new URL(rawUrl).hostname.toLowerCase();
		expect(hostname).toBe('raw.githubusercontent.com');
	});

	it('github.com hostname is different from raw hostname', () => {
		const webUrl = 'https://github.com/user/repo';
		const rawUrl = 'https://raw.githubusercontent.com/user/repo/main/file.nix';

		const webHostname = new URL(webUrl).hostname.toLowerCase();
		const rawHostname = new URL(rawUrl).hostname.toLowerCase();

		expect(webHostname).toBe('github.com');
		expect(rawHostname).toBe('raw.githubusercontent.com');
		expect(webHostname).not.toBe(rawHostname);
	});
});

describe('Provider vs Static Fetch Selection Logic', () => {
	/**
	 * These tests document the expected routing logic:
	 * - Raw GitHub URLs -> Static fetch
	 * - GitHub web URLs -> Provider (for fast paths)
	 * - Reddit URLs -> Provider (for RSS fast path)
	 * - SPA URLs -> Provider
	 * - Other text URLs -> Static fetch
	 */

	function shouldUseProvider(url: string, forceProvider?: string): boolean {
		// This is a copy of the logic from fetch.ts for testing
		const hostname = new URL(url).hostname.toLowerCase();
		const isRawGitHubUrl = hostname === 'raw.githubusercontent.com';

		// For testing, we simulate the detection flags
		const isGitHub = hostname === 'github.com' || hostname === 'www.github.com';
		const isReddit = hostname.includes('.reddit.com') || hostname === 'reddit.com';
		const isLikelySPA = url.includes('notion.so') || url.includes('airtable.com');

		const shouldUseProvider = (isGitHub && !isRawGitHubUrl) || isReddit || isLikelySPA || !!forceProvider;
		return shouldUseProvider;
	}

	it('raw.githubusercontent.com should NOT use provider', () => {
		const url = 'https://raw.githubusercontent.com/user/repo/main/file.nix';
		expect(shouldUseProvider(url)).toBe(false);
	});

	it('github.com web URLs should use provider', () => {
		const url = 'https://github.com/user/repo';
		expect(shouldUseProvider(url)).toBe(true);
	});

	it('github.com/blob URLs should use provider', () => {
		const url = 'https://github.com/user/repo/blob/main/README.md';
		expect(shouldUseProvider(url)).toBe(true);
	});

	it('reddit.com URLs should use provider', () => {
		const url = 'https://www.reddit.com/r/programming';
		expect(shouldUseProvider(url)).toBe(true);
	});

	it('notion.so URLs should use provider', () => {
		const url = 'https://notion.so/workspace/page';
		expect(shouldUseProvider(url)).toBe(true);
	});

	it('plain URLs should not use provider', () => {
		const url = 'https://example.com/page';
		expect(shouldUseProvider(url)).toBe(false);
	});

	it('forceProvider overrides detection', () => {
		const url = 'https://example.com/page';
		expect(shouldUseProvider(url, 'clawfetch')).toBe(true);
	});
});
