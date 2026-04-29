/**
 * Clawfetch Provider
 * 
 * Uses clawfetch CLI for content extraction.
 * Provides: Playwright + Mozilla Readability + Turndown
 * Plus fast paths for GitHub, Reddit RSS, and FlareSolverr support.
 */

import { execFileSync } from "node:child_process";
import {
  type WebfetchProvider,
  type ProviderFetchResult,
  type ProviderCapabilities,
  type URLDetection,
  type ProviderConfig,
  type ProviderError,
  ProviderError as ProviderErrorClass,
} from "./types";

/**
 * Parse clawfetch output into structured result
 */
interface ClawfetchOutput {
  metadata: {
    title?: string;
    author?: string;
    siteName?: string;
    finalUrl?: string;
    extraction?: string;
    fallbackSelector?: string;
  };
  markdown: string;
}

/**
 * Clawfetch provider using the clawfetch CLI
 */
export class ClawfetchProvider implements WebfetchProvider {
  readonly name = "clawfetch";
  readonly priority = 5; // Lower than default (tried second)
  
  readonly capabilities: ProviderCapabilities = {
    supportsSPA: true,
    supportsGitHubFastPath: true,
    supportsRedditRSS: true,
    supportsBotProtection: false, // Requires FlareSolverr externally
    returnsMetadata: true, // Returns rich metadata
  };
  
  private clawfetchPath: string | null = null;
  
  /**
   * Find clawfetch binary
   */
  private findClawfetch(): string | null {
    if (this.clawfetchPath) {
      return this.clawfetchPath;
    }
    
    // Check common locations
    const candidates = [
      "clawfetch", // In PATH
      "./node_modules/.bin/clawfetch", // Local install
      "/usr/local/bin/clawfetch",
      "/usr/bin/clawfetch",
    ];
    
    for (const candidate of candidates) {
      try {
        execFileSync(candidate, ["--help"], {
          encoding: "utf-8",
          stdio: "pipe",
        });
        this.clawfetchPath = candidate;
        return candidate;
      } catch {
        // Try next candidate
      }
    }
    
    return null;
  }
  
  /**
   * Check if clawfetch CLI is available
   */
  isAvailable(): boolean {
    return this.findClawfetch() !== null;
  }
  
  /**
   * Detect URL characteristics
   */
  detectUrl(url: string): URLDetection {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // GitHub URLs include both web interface and raw content URLs
    const isGitHubHost = hostname === "github.com" || 
                         hostname === "www.github.com" || 
                         hostname === "raw.githubusercontent.com";
    
    return {
      isGitHub: isGitHubHost,
      isReddit: hostname.includes(".reddit.com") || hostname === "reddit.com",
      isLikelySPA: isGitHubHost ? false : this.checkLikelySPA(url), // Raw URLs are not SPAs
      isLikelyBinary: this.checkLikelyBinary(url),
    };
  }
  
  /**
   * Main fetch implementation using clawfetch CLI
   */
  async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
    const clawfetch = this.findClawfetch();
    
    if (!clawfetch) {
      throw new ProviderErrorClass(
        "clawfetch not installed. Install with: npm install -g clawfetch",
        this.name
      );
    }
    
    const timeout = config?.timeout || 60000;
    
    try {
      const output = this.execClawfetch(clawfetch, url, timeout);
      return this.parseOutput(output, url);
    } catch (error) {
      if (error instanceof ProviderErrorClass) {
        throw error;
      }
      throw new ProviderErrorClass(
        error instanceof Error ? error.message : String(error),
        this.name,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Execute clawfetch CLI
   */
  private execClawfetch(clawfetch: string, url: string, timeout: number): string {
    try {
      return execFileSync(clawfetch, [url], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: Math.floor(timeout / 1000),
        env: {
          ...process.env,
          // Pass proxy if configured
          ...(process.env.HTTP_PROXY && { HTTP_PROXY: process.env.HTTP_PROXY }),
          ...(process.env.HTTPS_PROXY && { HTTPS_PROXY: process.env.HTTPS_PROXY }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderErrorClass(`clawfetch execution failed: ${message}`, this.name);
    }
  }
  
  /**
   * Parse clawfetch output (METADATA + MARKDOWN)
   */
  private parseOutput(output: string, originalUrl: string): ProviderFetchResult {
    const lines = output.split("\n");
    const metadata: ClawfetchOutput["metadata"] = {};
    const markdownParts: string[] = [];
    
    let inMarkdown = false;
    
    for (const line of lines) {
      if (line === "--- MARKDOWN ---") {
        inMarkdown = true;
        continue;
      }
      
      if (line === "--- METADATA ---") {
        continue;
      }
      
      if (inMarkdown) {
        markdownParts.push(line);
      } else {
        // Parse metadata line: "Key: Value"
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim().toLowerCase();
          const value = line.slice(colonIndex + 1).trim();
          
          switch (key) {
            case "title":
              metadata.title = value;
              break;
            case "author":
              metadata.author = value;
              break;
            case "site":
              metadata.siteName = value;
              break;
            case "finalurl":
              metadata.finalUrl = value;
              break;
            case "extraction":
              metadata.extraction = value;
              break;
            case "fallbackselector":
              metadata.fallbackSelector = value;
              break;
          }
        }
      }
    }
    
    const markdown = markdownParts.join("\n").trim();
    
    return {
      content: markdown,
      metadata: {
        title: metadata.title,
        author: metadata.author,
        siteName: metadata.siteName,
      },
      finalUrl: metadata.finalUrl || originalUrl,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: metadata.extraction || "unknown",
      fallbackSelector: metadata.fallbackSelector,
    };
  }
  
  /**
   * Check if URL is likely a SPA
   */
  private checkLikelySPA(url: string): boolean {
    const spaIndicators = [
      "reddit.com",
      "twitter.com",
      "x.com",
      "notion.so",
      "figma.com",
      "google.com/mail",
      "mail.google",
    ];
    
    const hostname = new URL(url).hostname.toLowerCase();
    return spaIndicators.some((indicator) => hostname.includes(indicator));
  }
  
  /**
   * Clean up resources (clawfetch handles its own cleanup)
   */
  async close(): Promise<void> {
    // clawfetch is stateless, nothing to clean up
  }
  
  /**
   * Check if URL is likely binary
   */
  private checkLikelyBinary(url: string): boolean {
    const binaryExtensions = [
      ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp",
      ".mp3", ".mp4", ".avi", ".mov",
    ];
    
    const urlLower = url.toLowerCase();
    return binaryExtensions.some((ext) => urlLower.includes(ext));
  }
}
