/**
 * Webfetch Provider Types
 * 
 * Defines the interface for content extraction providers.
 * Providers can use different browser engines, extractors, and converters
 * but must conform to this interface.
 */

/**
 * Metadata extracted from a webpage
 */
export interface FetchMetadata {
  title?: string;
  author?: string;
  siteName?: string;
  byline?: string;
  excerpt?: string;
  publishedTime?: string;
  language?: string;
  /**
   * Provider-specific discovery hint surfaced for programmatic consumers.
   * Currently used by the gh-cli provider to advertise GitHub fetch options
   * (e.g. `includeComments`) that the caller did not enable.
   */
  githubHint?: string;
}

/**
 * GitHub-specific fetch options.
 *
 * Future options (e.g. `maxCommentDepth`, `includeReviews`, `includeReactions`)
 * are additive on this object so the provider signature stays stable.
 */
export interface GitHubFetchOptions {
  /** When true, include issue/PR conversation comments and PR review threads. */
  includeComments?: boolean;
}

/**
 * Result from a provider's fetch operation
 */
export interface ProviderFetchResult {
  /** Extracted markdown content */
  content: string;
  /**
   * Original un-processed response (e.g. raw HTML for browser
   * providers, raw text for static fetch). Optional: providers that
   * already produce a clean structured payload (gh-cli, clawfetch)
   * leave it `undefined`. The research service writes this to
   * `input_raw.<ext>` in the session work dir.
   */
  rawContent?: string;
  /**
   * MIME type hint for `rawContent`. Used to pick the
   * `input_raw.<ext>` extension. `undefined` when no raw is set.
   */
  rawContentType?: string | null;
  /** Metadata extracted from the page */
  metadata: FetchMetadata;
  /** Source URL (may differ from input if redirected) */
  finalUrl: string;
  /** HTTP status code */
  status: number;
  /** Content-Type header */
  contentType: string | null;
  /** How the content was extracted */
  extractionMethod: string;
  /** Name of the provider that handled this fetch */
  providerName: string;
  /** Fallback selector used if not primary method */
  fallbackSelector?: string;
  /**
   * Rendered wait condition. `'spa'` (default provider, real
   * browser, network-idle wait), `'html'` (real browser,
   * domcontentloaded wait), or `'static'` (HTTP only).
   * Surfaced on `WebfetchDetails.processedAs` for the user-facing
   * `Processed as:` line. Defaults to `'spa'` for the default
   * provider for back-compat with the pre-0.9.0 baseline.
   */
  processedAs?: 'spa' | 'html' | 'static';
}

/**
 * Capabilities of a provider
 * 
 * All fields are optional to support the Interface Segregation Principle,
 * allowing providers to only declare the capabilities they support.
 */
export interface ProviderCapabilities {
  /** Supports JavaScript-heavy SPAs */
  supportsSPA?: boolean;
  /** Supports GitHub-specific fast paths */
  supportsGitHubFastPath?: boolean;
  /** Supports Reddit RSS fast path */
  supportsRedditRSS?: boolean;
  /** Supports Cloudflare/bot protection bypass */
  supportsBotProtection?: boolean;
  /** Returns rich metadata */
  returnsMetadata?: boolean;
}

/**
 * Detection info for a specific URL
 */
export interface URLDetection {
  /** Is this a GitHub URL? */
  isGitHub: boolean;
  /** Is this a Reddit URL? */
  isReddit: boolean;
  /** Is this likely a SPA (JS-heavy)? */
  isLikelySPA: boolean;
  /** Is this likely binary content? */
  isLikelyBinary: boolean;
}

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** Custom timeout in ms */
  timeout?: number;
  /** Wait strategy */
  waitFor?: 'networkidle' | 'domcontentloaded';
  /** User agent override */
  userAgent?: string;
  /** Proxy settings */
  proxy?: string;
  /** GitHub-specific fetch options */
  github?: GitHubFetchOptions;
  /**
   * Page-specific denylist selectors. Merged with the default
   * provider's `PAGE_DENYLIST_EXTRA` stack. Used by tests and
   * downstream callers to extend the default noise filter
   * (e.g. custom donation banners, cookie walls, site
   * interstitials).
   */
  extraDenylistSelectors?: ReadonlyArray<string>;
}

/**
 * Extended config with provider selection
 */
export interface FetchConfig extends ProviderConfig {
  /** Force specific provider */
  provider?: string;
}

/**
 * Webfetch Provider Interface
 * 
 * Implement this interface to create a new content extraction provider.
 */
export interface WebfetchProvider {
  /** Provider name (e.g., 'default', 'clawfetch') */
  readonly name: string;
  
  /** Provider priority (higher = tried first) */
  readonly priority: number;
  
  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;
  
  /**
   * Check if this provider is available/installed
   */
  isAvailable(): Promise<boolean> | boolean;
  
  /**
   * Detect URL characteristics to help with provider selection
   */
  detectUrl(url: string): URLDetection;
  
  /**
   * Fetch URL and extract content as markdown
   * 
   * @param url - URL to fetch
   * @param config - Optional configuration
   * @returns Promise<ProviderFetchResult>
   */
  fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult>;
  
  /**
   * Clean up resources (browser instances, etc.)
   */
  close?(): Promise<void>;
}

/**
 * Classified cause of a `ProviderError`. The fetch service
 * uses the reason to decide whether the fallback result is
 * worth caching (a transient reason like `timeout` or
 * `navigation_failed` should not poison the cache; a
 * deterministic reason like `low_text_ratio` is a successful
 * classification of the rendered page and is safe to cache).
 *
 * - `unknown` — the provider could not classify the cause.
 * - `timeout` — the underlying browser subprocess exceeded
 *   its budget (per-call or per-`get`).
 * - `navigation_failed` — the browser rendered a Chromium
 *   net-error page (DNS, connection refused, SSL error, …)
 *   rather than the requested URL.
 * - `low_text_ratio` — the rendered body did not contain
 *   enough prose to confidently extract; the provider fell
 *   back to plain text.
 */
export type ProviderErrorReason =
  | 'unknown'
  | 'timeout'
  | 'navigation_failed'
  | 'low_text_ratio';

/**
 * Error class for provider-specific errors
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly originalError?: Error,
    /**
     * Classified cause. Optional for back-compat with the
     * pre-v0.9.0 codebase; new call sites should pass a
     * value. The fetch service uses the reason to gate the
     * cache write on transient failures.
     */
    public readonly reason: ProviderErrorReason = 'unknown',
  ) {
    super(`[${providerName}] ${message}`);
    this.name = 'ProviderError';
  }
}

/**
 * Result when no provider can handle the URL
 */
export interface NoProviderResult {
  success: false;
  error: string;
  attemptedProviders: string[];
}

/**
 * Combined result from provider selection
 */
export type WebfetchResult = ProviderFetchResult | NoProviderResult;
