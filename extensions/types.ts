// Shared types for webfetch extension

import type { FetchPhase } from './helpers.js';

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	/**
	 * How the content was processed. Surfaces on the user-facing
	 * `Processed as: ...` header. v0.9.0 (M3) widened the union
	 * to distinguish the real-browser cases (`'spa'`, `'html'`)
	 * from the static-fallback (`'static'`, `'fallback'`) and
	 * the cache hit (`'cache'`) cases.
	 *
	 * The user-facing labels in `fetch-phases.ts::FETCH_PHASE_LABELS`
	 * are derived from this enum, so new values automatically
	 * pick up their phase label.
	 */
	processedAs:
		| 'spa'
		| 'html'
		| 'static'
		| 'fallback'
		| 'binary'
		| 'error'
		| 'cache'
		| 'partial'
		| 'metadata'
		| 'research';
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
	extracted?: boolean;
	browserWarning?: string;
	/**
	 * v0.9.0 (M3.D): when the `browserWarning` is shown
	 * once per session (the first call to land in the
	 * static-fallback path), subsequent calls set this flag
	 * instead of re-emitting the warning. The
	 * `Processed as: ...` header is still `static` so the
	 * caller can see they are on the static path; the
	 * browser-side warning is suppressed.
	 */
	staticOnly?: boolean;
	provider?: string;
	extractionMethod?: string;
	/** Current phase for streaming status display */
	phase?: FetchPhase;
	/** Whether this result was served from cache */
	cached?: boolean;
	/** Age of cached content in milliseconds */
	cacheAge?: number;
	/**
	 * Discovery hint from a provider (e.g. gh-cli advertising
	 * GitHub fetch options such as `includeComments` that the
	 * caller did not enable). Mirrors the in-content hint tail.
	 */
	githubHint?: string;
	/**
	 * Persistent session id of the spawned research subagent. Present
	 * on the agent-error path so the user can resume the failed
	 * transcript via `pi --session <id>` (extension) or by re-running
	 * the same `pi-webfetch webfetch …` invocation (CLI / MCP).
	 *
	 * @see docs/plans/PLAN_AGENT_ERROR_RESUME.md
	 */
	subagentSessionId?: string;
	/**
	 * Human-readable session name of the spawned research subagent.
	 * Surfaced in `pi -r` pickers. Mirrors the `--name <name>` argv
	 * the subagent was launched with.
	 */
	subagentSessionName?: string;
	/**
	 * The exact command the user should run to resume the failed
	 * subagent. Extension: `pi --session <id>`. CLI / MCP: the
	 * original `pi-webfetch webfetch <url> --query <query>` invocation
	 * echoed back.
	 */
	resumeCommand?: string;
	/**
	 * Surface-specific notification message produced on the agent-error
	 * path. The extension consumes it via `ctx.ui.notify`; the CLI
	 * writes it to stderr; the MCP server returns it under
	 * `_meta.details.notify` so an MCP client (e.g. Codex) can surface
	 * it to the user.
	 */
	notify?: string;
	/**
	 * Original un-processed response (e.g. the raw HTML from the
	 * browser / static fetch) when the provider surfaces it. The
	 * research service writes this to `input_raw.<ext>` in the
	 * session work dir so the subagent can re-read the source if it
	 * needs to grep for content the markdown conversion dropped.
	 * `undefined` for providers that don't expose raw (gh-cli,
	 * clawfetch, etc.).
	 */
	rawContent?: string;
	/**
	 * MIME type hint for `rawContent`. Used to pick the
	 * `input_raw.<ext>` extension (`.html`, `.json`, `.txt`, ...).
	 * `undefined` when no raw content is available.
	 */
	rawContentType?: string | null;
	/**
	 * Final URL after redirects, when the provider surfaces it
	 * (the default provider always does). Used by the cache
	 * content-validation pass to defend against the
	 * poisoned-cache case (review finding 1): a mismatched
	 * `finalUrl` causes the cache write to be rejected with a
	 * warning. `undefined` for providers that do not expose
	 * the post-redirect URL.
	 */
	finalUrl?: string;
	/**
	 * Page `<title>` extracted from the rendered HTML, when the
	 * provider surfaces it (the default provider does, via
	 * `ProviderFetchResult.metadata.title`). Used by the cache
	 * content-validation pass as a secondary signal: a
	 * `<title>` that does not contain the URL's path key
	 * (fuzzy-matched, see `validateCacheEntry`) rejects the
	 * cache write. `undefined` for providers / content types
	 * that do not produce a title.
	 */
	pageTitle?: string;
	/**
	 * Absolute path to the session work dir for the research
	 * subagent. `inputFile` and `inputRawFile` (when set) live
	 * under it. Populated on the research path; `undefined` for
	 * non-research fetches.
	 */
	workDir?: string;
	/**
	 * Absolute path to `input.md` in the session work dir. The
	 * research subagent reads this instead of receiving the
	 * content inline, so the prompt stays lean. `undefined` for
	 * non-research fetches.
	 */
	inputFile?: string;
	/**
	 * Absolute path to `input_raw.<ext>` in the session work dir.
	 * `undefined` when no raw content is available.
	 */
	inputRawFile?: string;
}

/**
 * GitHub-specific fetch options. Mirrors `GitHubFetchOptions` from
 * `src/providers/types.ts`; future options (e.g. `includeReviews`,
 * `maxCommentDepth`) are additive on this object.
 */
export interface GitHubFetchOptions {
	/** When true, include issue/PR conversation comments and PR review threads. */
	includeComments?: boolean;
}

export interface FetchResult {
	content: Array<{ type: 'text'; text: string }>;
	details: WebfetchDetails;
}

export interface ExtractResult {
	content: string;
	extracted: boolean;
}

export interface ProviderConfig {
	timeout?: number;
	waitFor?: 'networkidle' | 'domcontentloaded';
	forceProvider?: string;
	github?: GitHubFetchOptions;
}

export interface ProviderCapabilities {
	html: boolean;
	markdown: boolean;
	spa: boolean;
}

export interface URLDetection {
	type: 'github' | 'reddit' | 'binary' | 'spa' | 'unknown';
}

export interface ProviderFetchResult {
	content: string;
	contentType: string;
	status: number;
	extractionMethod?: string;
	providerName?: string;
	metadata?: Record<string, unknown>;
	/**
	 * Original un-processed response (e.g. raw HTML for browser
	 * providers, raw text for static fetch). The research service
	 * writes this to `input_raw.<ext>` in the session work dir so
	 * the subagent can grep the original markup when the markdown
	 * conversion drops something. Optional; providers that
	 * already produce a clean structured payload (gh-cli,
	 * clawfetch) leave it `undefined`.
	 */
	rawContent?: string;
	/** MIME type hint for `rawContent`. */
	rawContentType?: string | null;
	/**
	 * Final URL after redirects, when the provider surfaces it
	 * (the default provider always does). The fetch service
	 * forwards this onto `WebfetchDetails.finalUrl` so the
	 * cache content-validation pass can confirm the cache
	 * write is for the requested URL (review finding 1).
	 */
	finalUrl?: string;
	/**
	 * Rendered wait condition reported by the provider. `'spa'`
	 * (default provider, network-idle wait), `'html'` (real
	 * browser, domcontentloaded wait), or `'static'` (HTTP
	 * only). Forwarded onto `WebfetchDetails.processedAs`.
	 */
	processedAs?: 'spa' | 'html' | 'static';
}

export interface WebfetchProvider {
	readonly name: string;
	readonly priority: number;
	readonly capabilities: ProviderCapabilities;
	isAvailable(): boolean;
	detectUrl(url: string): URLDetection;
	fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult | null>;
}
