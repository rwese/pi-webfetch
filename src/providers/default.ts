/**
 * Default Provider
 *
 * Uses agent-browser for rendering + cheerio for extraction + turndown for conversion.
 * This is the current/default implementation that provides browser-based fetching.
 *
 * v0.9.0 (M3): the user-facing name was renamed from
 * `"default"` to `"browser"` (the class internal `name` stays
 * `"default"` for back-compat with the `--provider` flag and
 * the provider manager's priority sort). The `displayName`
 * field carries the user-facing string and is forwarded onto
 * `ProviderFetchResult.providerName` so the rename is purely
 * at the boundary.
 */

import { load } from 'cheerio';
import { execAsync } from '../utils/process.js';
import {
	type WebfetchProvider,
	type ProviderFetchResult,
	type ProviderCapabilities,
	type URLDetection,
	type ProviderConfig,
	ProviderError,
} from './types.js';
import {
	BrowserManager,
	createTurndownService,
	extractTitle,
	cleanHtml,
	calculateTextRatio,
} from './internal/index.js';
import { detectUrl } from './internal/url-detector.js';
import { providerDisplayName } from '../utils/display-name.js';

/**
 * Page-specific selectors added on top of the default denylist.
 * Sourced from review finding 3 (BXAC / M2): the Wikipedia
 * donation banner (`#mw-donation-banner` / `frb-inline`),
 * siteNotice, jump-to-content, and a handful of
 * editor-only / print-only containers surfaced as content
 * noise on the v0.8.0 baseline. Kept in one place so the
 * default provider stays the single source of truth for the
 * denylist stack.
 */
const PAGE_DENYLIST_EXTRA: ReadonlyArray<string> = [
	// Wikipedia / MediaWiki: donation banner + siteNotice +
	// jump-to-content link. These are real DOM content on a
	// `*wikipedia.org/wiki/*` page and got captured as the
	// first paragraph in the v0.8.0 conversion.
	'#mw-donation-banner',
	'#siteNotice',
	'.frb-inline',
	'#mw-jump-to-nav',
	'.mw-jump-link',
	'.reference',
	'.reflist',
	'.references',
	'.mw-editsection',
	'.navbox',
	'.metadata.mbox-small',
	// Print / footer chrome specific to article pages.
	'.printfooter',
	'#footer',
	// Cookie / consent interstitials that occasionally get
	// captured on first hit.
	'#mw-cookiewarning',
	'.cookiealert',
	// Wikipedia inline MathJax (BUG-2026-06-06-JGCMZSOB-YZOYE).
	// The MediaWiki extensions' MathJax wrapper carries the
	// formula's TeX source in three places (the MathML
	// `<annotation encoding="TeX">`, the `<img alt="...">`,
	// and a `<span style="display: none">` screen-reader
	// fallback). The TeX source duplicates 3-4 times in the
	// converted markdown. The selector denylist strips the
	// whole wrapper except the rendered `<img>` (the
	// `mwe-math-mathml-*` rule in `turndown-config.ts`
	// keeps the image; the cheerio strip here is the
	// belt-and-braces fallback for the path that does not
	// hit the turndown rule, e.g. the static-cleanHtml
	// calls in tests).
	'span.mwe-math-mathml-display',
	'span.mwe-math-mathml-inline',
	// Display-none fallback inside a MathJax wrapper. Scoped
	// to a `mwe-math-*` parent (via the cascade above) so a
	// legitimate `display: none` on another site is not
	// affected.
	'span.mwe-math-mathml-display span[style*="display: none"]',
	'span.mwe-math-mathml-inline span[style*="display: none"]',
];

/**
 * Chromium net-error page substrings. When any of these are
 * present in the rendered body, the browser was actually
 * showing Chromium's net-error page, not the requested URL.
 * Surfacing this as a successful `200` is the
 * BUG-2026-06-06-JGCMZSNR-YZOYE regression: the user
 * expects a `Status: 0 + Error: TypeError: fetch failed`
 * (the static-fetch path's behaviour) and instead gets a
 * misleading 200 with the error page text.
 *
 * Detection is heuristic: we look for the literal string
 * `ERR_<NAME>` in the body. The list is the documented 90 %
 * case (DNS, connection refused, SSL, redirect loop,
 * unreachable, etc.). Localised Chromium builds may use
 * different error copy; the static-fetch fallback catches
 * the eventual transport failure on retry regardless.
 */
const CHROMIUM_NET_ERROR_CODES: ReadonlyArray<string> = [
	'ERR_NAME_NOT_RESOLVED',
	'ERR_CONNECTION_REFUSED',
	'ERR_CONNECTION_TIMED_OUT',
	'ERR_CONNECTION_RESET',
	'ERR_INTERNET_DISCONNECTED',
	'ERR_SSL_PROTOCOL_ERROR',
	'ERR_CERT_AUTHORITY_INVALID',
	'ERR_CERT_DATE_INVALID',
	'ERR_TOO_MANY_REDIRECTS',
	'ERR_INVALID_URL',
	'ERR_ADDRESS_UNREACHABLE',
	'ERR_EMPTY_RESPONSE',
	'ERR_ABORTED',
	'ERR_BLOCKED_BY_CLIENT',
	'ERR_BLOCKED_BY_ADMINISTRATOR',
	'ERR_NETWORK_CHANGED',
	'ERR_PROXY_CONNECTION_FAILED',
	'ERR_QUIC_PROTOCOL_ERROR',
];

/**
 * Detect a Chromium net-error page. Returns the matched
 * error code (e.g. `ERR_NAME_NOT_RESOLVED`) or `undefined`
 * when the body does not look like a Chromium error page.
 *
 * The scan is intentionally narrow: the string
 * `ERR_NAME_NOT_RESOLVED` appears nowhere on legitimate web
 * pages, and a match implies the browser was rendering the
 * error page. Wider patterns (e.g. `ERR_` alone) would
 * false-positive on the literal text `ERR_` in user content.
 */
export function detectChromiumNetError(body: string | undefined): string | undefined {
	if (!body) return undefined;
	for (const code of CHROMIUM_NET_ERROR_CODES) {
		if (body.includes(code)) return code;
	}
	return undefined;
}

/**
 * Default provider using agent-browser + cheerio + turndown
 */
export class DefaultProvider implements WebfetchProvider {
	readonly name = 'default';
	/**
	 * User-facing name. Surfaced on
	 * `WebfetchDetails.provider` / `ProviderFetchResult.providerName`
	 * and in the `/webfetch:info` provider list. The rename
	 * from `"default"` to `"browser"` (M3) reads as
	 * "real-browser rendering" instead of "the fallback /
	 * GitHub fast path" — see review finding 8.
	 */
	readonly displayName = providerDisplayName('default');
	readonly priority = 10;

	/** Browser manager instance */
	private browser: BrowserManager;

	readonly capabilities: ProviderCapabilities = {
		supportsSPA: true,
		supportsGitHubFastPath: false, // Handled at higher level
		supportsRedditRSS: false,
		supportsBotProtection: false,
		returnsMetadata: false, // Only URL/status metadata
	};

	/**
	 * Create provider. The `sessionName` option is for tests; in
	 * production the `BrowserManager` derives a stable per-process
	 * session name from `${os.hostname()}:${process.pid}`.
	 */
	constructor(opts?: { sessionName?: string }) {
		this.browser = new BrowserManager(opts);
	}

	/**
	 * Check if agent-browser CLI is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execAsync('agent-browser', ['--version']);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Detect URL characteristics
	 */
	detectUrl(url: string): URLDetection {
		return detectUrl(url);
	}

	/**
	 * Main fetch implementation - protected by mutex to prevent race conditions
	 */
	async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
		const timeout = config?.timeout || 30000;
		const waitFor = config?.waitFor || 'networkidle';

		// Check availability
		if (!(await this.isAvailable())) {
			throw new ProviderError(
				'agent-browser not installed. Install with: npm i -g agent-browser && agent-browser install',
				this.name,
			);
		}

		// Acquire mutex to prevent concurrent browser access
		await this.browser.acquire();

		try {
			// Extract HTML via browser
			const htmlResult = await this.browser.extractHtml(url, waitFor, timeout);

			if (!htmlResult.html) {
				throw new ProviderError('Failed to extract HTML from browser', this.name);
			}

			// BUG-2026-06-06-JGCMZSNR-YZOYE: detect a Chromium
			// net-error page. The browser renders
			// `ERR_NAME_NOT_RESOLVED` etc. as a regular
			// text/plain body; without this check, the user
			// gets a `200` with the error page text. We throw
			// a `ProviderError` with `reason: 'navigation_failed'`
			// so the fetch service falls back to static fetch
			// (which produces the documented `Status: 0 + TypeError`
			// contract).
			const netError = detectChromiumNetError(htmlResult.html);
			if (netError) {
				throw new ProviderError(
					`Chromium net-error page rendered for ${url}: ${netError}`,
					this.name,
					undefined,
					'navigation_failed',
				);
			}

			// Clean HTML and check text ratio. The
			// `extraSelectors` stack carries page-specific
			// noise (Wikipedia donation banner, etc.); tests
			// can extend it further via `ProviderConfig`.
			const extraSelectors =
				(config as { extraDenylistSelectors?: ReadonlyArray<string> } | undefined)
					?.extraDenylistSelectors ?? PAGE_DENYLIST_EXTRA;
			const cleanedHtml = cleanHtml(htmlResult.html, { extraSelectors });
			const textRatio = calculateTextRatio(cleanedHtml);

			// If text ratio is too low, fallback to plain text
			let content: string;
			let extractionMethod: string;
			let reportedContentType: string;

			if (textRatio < 0.05) {
				// Fallback: get plain text from browser
				const textResult = await this.browser.extractText(url, waitFor, timeout);
				// Repeat the net-error scan on the text
				// path; a Chromium error page in text mode is
				// also misleading.
				const textNetError = detectChromiumNetError(textResult);
				if (textNetError) {
					throw new ProviderError(
						`Chromium net-error page rendered for ${url}: ${textNetError}`,
						this.name,
						undefined,
						'navigation_failed',
					);
				}
				content = textResult;
				extractionMethod = 'browser-text-fallback';
				// Low text ratio suggests plain text content (like raw GitHub files)
				reportedContentType = 'text/plain';
			} else {
				// Convert HTML to markdown
				content = createTurndownService().turndown(cleanedHtml);
				extractionMethod =
					htmlResult.contentSource === 'body'
						? 'browser-html-body'
						: `browser-html-${htmlResult.contentSource}`;
				reportedContentType = 'text/html';
			}

			return {
				content,
				// Surface the raw HTML so the research service can
				// write it to `input_raw.html` in the session work
				// dir. The subagent can grep the original markup
				// when the markdown conversion drops something
				// (e.g. metadata inside a `<script>` or `<meta>`
				// tag, or attribute values lost during
				// cheerio/turndown).
				rawContent: htmlResult.html,
				rawContentType: 'text/html',
				metadata: {
					title: extractTitle(htmlResult.html),
				},
				finalUrl: url,
				status: 200,
				contentType: reportedContentType,
				extractionMethod,
				// v0.9.0: user-facing name is `browser`, not
				// `default`. The internal `this.name` stays
				// `default` for back-compat with the provider
				// manager and the `--provider` flag.
				providerName: this.displayName,
				fallbackSelector: htmlResult.contentSource === 'body' ? 'body' : undefined,
			};
		} catch (error) {
			if (error instanceof ProviderError) {
				throw error;
			}
			// Classify the cause. The `process.js` `execAsync`
			// uses `Command timed out after ${ms}ms` for
			// timeout errors; treat that as `'timeout'`. Any
			// other unclassified error is `'unknown'`. The
			// fetch service uses the reason to decide whether
			// the fallback result is transient (skip the
			// cache write) or safe to persist.
			const message = error instanceof Error ? error.message : String(error);
			const isTimeout = /timed out|timeout/i.test(message);
			throw new ProviderError(
				message,
				this.name,
				error instanceof Error ? error : undefined,
				isTimeout ? 'timeout' : 'unknown',
			);
		} finally {
			// Always release the mutex
			this.browser.release();
		}
	}

	/**
	 * Clean up browser resources. Closes the per-process
	 * `agent-browser` session.
	 */
	async close(): Promise<void> {
		await this.browser.close();
	}
}
