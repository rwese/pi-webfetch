/**
 * Provider Manager
 *
 * Manages provider registration, auto-detection, and selection.
 * Implements a chain-of-responsibility pattern for provider fallback.
 */

import {
  type WebfetchProvider,
  type ProviderFetchResult,
  type WebfetchResult,
  type NoProviderResult,
  type ProviderConfig,
  type FetchConfig,
  type URLDetection,
  ProviderError,
} from "./types";
import { DefaultProvider } from "./default";
import { ClawfetchProvider } from "./clawfetch";
import { GhCliProvider } from "./gh-cli";

/**
 * Provider manager configuration
 */
export interface ProviderManagerConfig {
  /** Override the default provider selection */
  forcedProvider?: string;
  /** Enable/disable specific providers */
  enabledProviders?: string[];
  /** Default timeout for all providers */
  defaultTimeout?: number;
}

/**
 * Provider manager for handling provider registration and selection
 */
export class ProviderManager {
  private providers: Map<string, WebfetchProvider> = new Map();
  private config: ProviderManagerConfig;

  /**
   * Create a new provider manager
   */
  constructor(config: ProviderManagerConfig = {}) {
    this.config = config;
    this.registerDefaultProviders();
  }

  /**
   * Register the default providers
   */
  private registerDefaultProviders(): void {
    // Register in priority order (higher priority = higher preference)
    const defaultProviders: WebfetchProvider[] = [
      new DefaultProvider(),
      new ClawfetchProvider(),
      new GhCliProvider(),
    ];

    for (const provider of defaultProviders) {
      // Skip if provider is explicitly disabled
      if (this.config.enabledProviders && 
          !this.config.enabledProviders.includes(provider.name)) {
        continue;
      }
      this.register(provider);
    }
  }

  /**
   * Register a new provider
   */
  register(provider: WebfetchProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Unregister a provider
   */
  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Get a specific provider by name
   */
  get(name: string): WebfetchProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   */
  getAll(): WebfetchProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers sorted by priority (highest first)
   */
  getSortedProviders(): WebfetchProvider[] {
    return this.getAll().sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if provider is available (handles sync and async)
   */
  private async isProviderAvailable(provider: WebfetchProvider): Promise<boolean> {
    const result = provider.isAvailable();
    return result instanceof Promise ? await result : result;
  }

  /**
   * Get all available providers (that pass isAvailable check)
   */
  async getAvailableProviders(): Promise<WebfetchProvider[]> {
    const sorted = this.getSortedProviders();
    const available: WebfetchProvider[] = [];
    for (const p of sorted) {
      if (await this.isProviderAvailable(p)) {
        available.push(p);
      }
    }
    return available;
  }

  /**
   * Check if any provider is available
   */
  async hasAvailableProvider(): Promise<boolean> {
    const available = await this.getAvailableProviders();
    return available.length > 0;
  }

  /**
   * Select the best provider for a URL
   */
  async selectProvider(url: string, config?: FetchConfig): Promise<WebfetchProvider | null> {
    // If forced provider is configured, use it
    if (this.config.forcedProvider) {
      const forced = this.providers.get(this.config.forcedProvider);
      if (forced && await this.isProviderAvailable(forced)) {
        return forced;
      }
    }

    // If configured in options, use that
    if (config && "provider" in config) {
      const forced = this.providers.get((config as { provider?: string }).provider || "");
      if (forced && await this.isProviderAvailable(forced)) {
        return forced;
      }
    }

    // Auto-detect: get all available providers sorted by priority
    const available = await this.getAvailableProviders();

    if (available.length === 0) {
      return null;
    }

    // For special URLs, prefer providers with specific support
    const urlDetection = available[0].detectUrl(url);
    
    // GitHub URLs: prefer gh-cli (authenticated, structured data)
    if (urlDetection.isGitHub) {
      const ghCli = this.providers.get("gh-cli");
      if (ghCli && await this.isProviderAvailable(ghCli)) {
        return ghCli;
      }
      // Fall back to clawfetch if gh-cli not available
      const clawfetch = this.providers.get("clawfetch");
      if (clawfetch && await this.isProviderAvailable(clawfetch)) {
        return clawfetch;
      }
    }

    // Reddit URLs: prefer clawfetch (has RSS fast path)
    if (urlDetection.isReddit) {
      const clawfetch = this.providers.get("clawfetch");
      if (clawfetch && await this.isProviderAvailable(clawfetch)) {
        return clawfetch;
      }
    }

    // Binary URLs: skip browser providers
    if (urlDetection.isLikelyBinary) {
      return null;
    }

    // Default: use highest priority available provider
    return available[0];
  }

  /**
   * Fetch URL using the best available provider
   *
   * Tries providers in priority order until one succeeds.
   */
  async fetch(
    url: string,
    config?: FetchConfig
  ): Promise<WebfetchResult> {
    const attemptedProviders: string[] = [];

    // Get the selected primary provider
    let provider = await this.selectProvider(url, config);

    // If forced provider not available, fall back to auto-selection
    if (!provider && this.config.forcedProvider) {
      provider = await this.selectProvider(url);
    }

    if (!provider) {
      return {
        success: false,
        error: "No suitable provider available",
        attemptedProviders: [],
      };
    }

    // Try the primary provider
    attemptedProviders.push(provider.name);

    try {
      const result = await provider.fetch(url, config);
      return result;
    } catch (primaryError) {
      // Primary failed, try fallback providers
      const available = await this.getAvailableProviders();

      for (const fallback of available) {
        if (fallback.name === provider.name) {
          continue;
        }

        attemptedProviders.push(fallback.name);

        try {
          const result = await fallback.fetch(url, config);
          return result;
        } catch {
          // Continue to next fallback
        }
      }

      // All providers failed
      const errorMessage = primaryError instanceof Error
        ? primaryError.message
        : String(primaryError);

      return {
        success: false,
        error: errorMessage,
        attemptedProviders,
      };
    }
  }

  /**
   * Detect URL type using the first available provider
   */
  async detectUrl(url: string): Promise<URLDetection> {
    const available = await this.getAvailableProviders();
    if (available.length === 0) {
      return {
        isGitHub: false,
        isReddit: false,
        isLikelySPA: false,
        isLikelyBinary: false,
      };
    }
    return available[0].detectUrl(url);
  }

  /**
   * Close all providers (cleanup resources)
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const provider of this.providers.values()) {
      if (provider.close) {
        closePromises.push(provider.close());
      }
    }

    await Promise.all(closePromises);
  }
}

/**
 * Create a default provider manager with standard configuration
 */
export function createProviderManager(config?: ProviderManagerConfig): ProviderManager {
  return new ProviderManager(config);
}
