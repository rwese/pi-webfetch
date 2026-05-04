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
}

/**
 * Result from a provider's fetch operation
 */
export interface ProviderFetchResult {
  /** Extracted markdown content */
  content: string;
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
 * Error class for provider-specific errors
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly originalError?: Error
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
