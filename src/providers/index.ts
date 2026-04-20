/**
 * Webfetch Providers
 * 
 * Provider abstraction for content extraction.
 * Supports multiple backends (agent-browser, clawfetch) with auto-detection.
 */

// Types
export {
  type FetchMetadata,
  type ProviderFetchResult,
  type ProviderCapabilities,
  type URLDetection,
  type ProviderConfig,
  type FetchConfig,
  type NoProviderResult,
  type WebfetchResult,
  ProviderError,
} from "./types";

// Providers
export { DefaultProvider } from "./default";
export { ClawfetchProvider } from "./clawfetch";

// Manager
export {
  ProviderManager,
  createProviderManager,
  type ProviderManagerConfig,
} from "./manager";
