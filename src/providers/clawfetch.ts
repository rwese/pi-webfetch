/**
 * Clawfetch Provider
 * 
 * Uses clawfetch CLI for content extraction.
 * Provides: Playwright + Mozilla Readability + Turndown
 * Plus fast paths for GitHub, Reddit RSS, and FlareSolverr support.
 */

import { spawn } from "node:child_process";
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
 * Execute a command asynchronously using spawn
 */
function execAsync(
  command: string,
  args: string[],
  options: { timeout?: number; env?: Record<string, string> } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    if (options.timeout) {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${options.timeout}ms`));
      }, options.timeout);

      proc.on('close', () => clearTimeout(timer));
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

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
 * Simple async mutex for preventing concurrent access
 */
class ClawfetchMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next!();
    } else {
      this.locked = false;
    }
  }
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

  /** Mutex to prevent concurrent clawfetch invocations */
  private mutex = new ClawfetchMutex();
  private clawfetchPath: string | null = null;

  /**
   * Find clawfetch binary (async version)
   */
  private async findClawfetchAsync(): Promise<string | null> {
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
        await execAsync(candidate, ["--help"]);
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
  async isAvailable(): Promise<boolean> {
    return (await this.findClawfetchAsync()) !== null;
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
   * Main fetch implementation using clawfetch CLI - protected by mutex
   */
  async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
    const clawfetch = await this.findClawfetchAsync();

    if (!clawfetch) {
      throw new ProviderErrorClass(
        "clawfetch not installed. Install with: npm install -g clawfetch",
        this.name
      );
    }

    const timeout = config?.timeout || 60000;

    // Acquire mutex to prevent concurrent Playwright instances
    await this.mutex.acquire();

    try {
      const output = await this.execClawfetchAsync(clawfetch, url, timeout);
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
    } finally {
      this.mutex.release();
    }
  }

  /**
   * Execute clawfetch CLI (async version)
   */
  private async execClawfetchAsync(clawfetch: string, url: string, timeout: number): Promise<string> {
    try {
      const env: Record<string, string> = {};
      if (process.env.HTTP_PROXY) env.HTTP_PROXY = process.env.HTTP_PROXY;
      if (process.env.HTTPS_PROXY) env.HTTPS_PROXY = process.env.HTTPS_PROXY;

      const stdout = await execAsync(clawfetch, [url], {
        timeout: Math.floor(timeout / 1000),
        env: Object.keys(env).length > 0 ? env : undefined,
      });
      return stdout;
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
      providerName: this.name,
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
