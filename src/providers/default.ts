/**
 * Default Provider
 * 
 * Uses agent-browser for rendering + cheerio for extraction + turndown for conversion.
 * This is the current/default implementation that provides browser-based fetching.
 */

import { load } from "cheerio";
import TurndownService from "turndown";
import { execAsync } from "../utils/process.js";
import {
	type WebfetchProvider,
	type ProviderFetchResult,
	type ProviderCapabilities,
	type URLDetection,
	type ProviderConfig,
	ProviderError,
} from "./types";

/** Common binary file extensions */
const BINARY_EXTENSIONS = [
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm",
  ".exe", ".dmg", ".pkg", ".deb", ".rpm", ".appimage",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
];

/** Default browser idle timeout in ms (5 minutes) */
const DEFAULT_BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000;

/**
 * Simple async mutex for preventing concurrent browser access
 */
class BrowserMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquire the lock. If already locked, waits until lock is released.
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Queue this request
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release the lock and process next waiting request
   */
  release(): void {
    if (this.waitQueue.length > 0) {
      // Process next in queue
      const next = this.waitQueue.shift();
      next!();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Default provider using agent-browser + cheerio + turndown
 */
export class DefaultProvider implements WebfetchProvider {
  readonly name = "default";
  readonly priority = 10;

  /** Mutex to prevent concurrent browser access */
  private browserMutex = new BrowserMutex();

  /** Track if browser is currently open */
  private browserOpen = false;

  /** Current URL in browser */
  private currentUrl: string | null = null;

  /** Timer for closing browser after idle */
  private closeTimer: NodeJS.Timeout | null = null;

  /** Configurable idle timeout */
  private idleTimeout: number;

  readonly capabilities: ProviderCapabilities = {
    supportsSPA: true,
    supportsGitHubFastPath: false, // Handled at higher level
    supportsRedditRSS: false,
    supportsBotProtection: false,
    returnsMetadata: false, // Only URL/status metadata
  };

  /**
   * Create provider with configurable idle timeout
   */
  constructor(idleTimeoutMs?: number) {
    this.idleTimeout = idleTimeoutMs ?? DEFAULT_BROWSER_IDLE_TIMEOUT;
  }

  /**
   * Check if agent-browser CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("agent-browser", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect URL characteristics
   */
  detectUrl(url: string): URLDetection {
    const hostname = new URL(url).hostname.toLowerCase();

    // GitHub URLs include both web interface and raw content URLs
    const isGitHubHost = hostname === "github.com" ||
                         hostname === "www.github.com" ||
                         hostname === "raw.githubusercontent.com";

    return {
      isGitHub: isGitHubHost,
      isReddit: hostname.includes(".reddit.com") || hostname === "reddit.com",
      isLikelySPA: isGitHubHost ? false : this.checkLikelySPA(url), // Raw URLs are not SPAs
      isLikelyBinary: this.isLikelyBinaryUrl(url),
    };
  }

  /**
   * Main fetch implementation - protected by mutex to prevent race conditions
   */
  async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
    const timeout = config?.timeout || 30000;
    const waitFor = config?.waitFor || "networkidle";

    // Check availability
    if (!(await this.isAvailable())) {
      throw new ProviderError(
        "agent-browser not installed. Install with: npm i -g agent-browser && agent-browser install",
        this.name
      );
    }

    // Acquire mutex to prevent concurrent browser access
    await this.browserMutex.acquire();

    try {
      // Extract HTML via browser
      const htmlResult = await this.extractHtmlFromBrowser(url, waitFor, timeout);

      if (!htmlResult.html) {
        throw new ProviderError("Failed to extract HTML from browser", this.name);
      }

      // Clean HTML and check text ratio
      const $ = load(htmlResult.html);
      $("script, style, nav, footer, header, aside, .header, .footer, .sidebar, .navbar").remove();

      const textContent = $.text();
      const textRatio = textContent.length / Math.max(htmlResult.html.length, 1);

      // If text ratio is too low, fallback to plain text
      let content: string;
      let extractionMethod: string;
      let reportedContentType: string;

      if (textRatio < 0.05) {
        // Fallback: get plain text from browser
        const textResult = await this.extractTextFromBrowser(url, waitFor, timeout);
        content = textResult;
        extractionMethod = "browser-text-fallback";
        // Low text ratio suggests plain text content (like raw GitHub files)
        reportedContentType = "text/plain";
      } else {
        // Convert HTML to markdown
        content = this.convertToMarkdown($.html());
        extractionMethod = htmlResult.contentSource === "body"
          ? "browser-html-body"
          : `browser-html-${htmlResult.contentSource}`;
        reportedContentType = "text/html";
      }

      return {
        content,
        metadata: {
          title: this.extractTitle(htmlResult.html),
        },
        finalUrl: url,
        status: 200,
        contentType: reportedContentType,
        extractionMethod,
        providerName: this.name,
        fallbackSelector: htmlResult.contentSource === "body" ? "body" : undefined,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        error instanceof Error ? error.message : String(error),
        this.name,
        error instanceof Error ? error : undefined
      );
    } finally {
      // Always release the mutex
      this.browserMutex.release();
    }
  }

  /**
   * Reset the idle close timer
   */
  private resetCloseTimer(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
    }
    this.closeTimer = setTimeout(() => {
      this.safeClose();
    }, this.idleTimeout);
  }

  /**
   * Safely close browser - used in finally blocks
   */
  private async safeClose(): Promise<void> {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.browserOpen) {
      try {
        await execAsync("agent-browser", ["close"]);
      } catch {
        // Ignore close errors
      }
      this.browserOpen = false;
      this.currentUrl = null;
    }
  }

  /**
   * Extract HTML from browser using agent-browser
   */
  private async extractHtmlFromBrowser(
    url: string,
    waitFor: string,
    timeout: number
  ): Promise<{ html: string; contentSource: string }> {
    let html = "";
    let contentSource = "body";

    // Open URL or navigate if browser already open
    if (!this.browserOpen) {
      await execAsync("agent-browser", ["open", url], { timeout });
      this.browserOpen = true;
    } else if (this.currentUrl !== url) {
      // Navigate to new URL if different
      await execAsync("agent-browser", ["open", url], { timeout });
    }
    this.currentUrl = url;

    // Wait for load
    await execAsync("agent-browser", ["wait", "--load", waitFor], { timeout });

    // Reset idle timer on successful navigation
    this.resetCloseTimer();

    // Try article first
    try {
      const articleHtml = await execAsync(
        "agent-browser",
        ["get", "html", "article"],
        { timeout: 5000 }
      );
      if (articleHtml && articleHtml.trim().length > 100) {
        html = articleHtml;
        contentSource = "article";
      }
    } catch {
      // Continue
    }

    // Try main
    if (!html) {
      try {
        const mainHtml = await execAsync(
          "agent-browser",
          ["get", "html", "main"],
          { timeout: 5000 }
        );
        if (mainHtml && mainHtml.trim().length > 100) {
          html = mainHtml;
          contentSource = "main";
        }
      } catch {
        // Continue
      }
    }

    // Fallback to body
    if (!html || html.trim().length < 100) {
      const bodyHtml = await execAsync("agent-browser", ["get", "html", "body"], { timeout });
      html = bodyHtml;
      contentSource = "body";
    }

    return { html, contentSource };
  }

  /**
   * Extract plain text from browser
   */
  private async extractTextFromBrowser(
    url: string,
    waitFor: string,
    timeout: number
  ): Promise<string> {
    // Open URL or navigate if browser already open
    if (!this.browserOpen) {
      await execAsync("agent-browser", ["open", url], { timeout });
      this.browserOpen = true;
    } else if (this.currentUrl !== url) {
      await execAsync("agent-browser", ["open", url], { timeout });
    }
    this.currentUrl = url;

    // Wait for load
    await execAsync("agent-browser", ["wait", "--load", waitFor], { timeout });

    // Get text from body
    const bodyText = await execAsync("agent-browser", ["get", "text", "body"], { timeout });

    // Reset idle timer
    this.resetCloseTimer();

    return bodyText;
  }

  /**
   * Clean up browser resources
   */
  async close(): Promise<void> {
    this.safeClose();
  }

  /**
   * Convert HTML to Markdown using turndown
   */
  private convertToMarkdown(html: string): string {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });

    // Custom rule for preserving code blocks
    td.addRule("preserveCodeBlocks", {
      filter: (node) => node.nodeName === "PRE" && !!node.querySelector("code"),
      replacement: (content) => content,
    });

    return td.turndown(html);
  }

  /**
   * Extract title from HTML
   */
  private extractTitle(html: string): string | undefined {
    const $ = load(html);
    const title = $("title").text().trim();
    return title || undefined;
  }

  /**
   * Check if URL likely points to binary content
   */
  private isLikelyBinaryUrl(url: string): boolean {
    const urlWithoutQuery = url.split(/[?#]/)[0].toLowerCase();
    return BINARY_EXTENSIONS.some((ext) => urlWithoutQuery.endsWith(ext));
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
}
