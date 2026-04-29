/**
 * Default Provider
 * 
 * Uses agent-browser for rendering + cheerio for extraction + turndown for conversion.
 * This is the current/default implementation that provides browser-based fetching.
 */

import { execFileSync } from "node:child_process";
import { load } from "cheerio";
import TurndownService from "turndown";
import {
  type WebfetchProvider,
  type ProviderFetchResult,
  type ProviderCapabilities,
  type URLDetection,
  type ProviderConfig,
  type ProviderError,
  ProviderError as ProviderErrorClass,
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
 * Default provider using agent-browser + cheerio + turndown
 */
export class DefaultProvider implements WebfetchProvider {
  readonly name = "default";
  readonly priority = 10;
  
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
  isAvailable(): boolean {
    try {
      execFileSync("agent-browser", ["--version"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
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
   * Main fetch implementation
   */
  async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
    const timeout = config?.timeout || 30000;
    const waitFor = config?.waitFor || "networkidle";
    
    // Check availability
    if (!this.isAvailable()) {
      throw new ProviderErrorClass(
        "agent-browser not installed. Install with: npm i -g agent-browser && agent-browser install",
        this.name
      );
    }
    
    try {
      // Extract HTML via browser
      const htmlResult = await this.extractHtmlFromBrowser(url, waitFor, timeout);
      
      if (!htmlResult.html) {
        throw new ProviderErrorClass("Failed to extract HTML from browser", this.name);
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
  private safeClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.browserOpen) {
      try {
        execFileSync("agent-browser", ["close"], {
          encoding: "utf-8",
          stdio: "pipe",
        });
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
    
    try {
      // Open URL or navigate if browser already open
      if (!this.browserOpen) {
        execFileSync("agent-browser", ["open", url], {
          encoding: "utf-8",
          stdio: "pipe",
          timeout,
        });
        this.browserOpen = true;
      } else if (this.currentUrl !== url) {
        // Navigate to new URL if different
        execFileSync("agent-browser", ["open", url], {
          encoding: "utf-8",
          stdio: "pipe",
          timeout,
        });
      }
      this.currentUrl = url;
      
      // Wait for load
      execFileSync("agent-browser", ["wait", "--load", waitFor], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout,
      });
      
      // Reset idle timer on successful navigation
      this.resetCloseTimer();
      
      // Try article first
      try {
        const articleHtml = execFileSync(
          "agent-browser",
          ["get", "html", "article"],
          { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
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
          const mainHtml = execFileSync(
            "agent-browser",
            ["get", "html", "main"],
            { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
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
        html = execFileSync("agent-browser", ["get", "html", "body"], {
          encoding: "utf-8",
          stdio: "pipe",
          timeout,
        });
        contentSource = "body";
      }
    } finally {
      // Don't close browser - let idle timer handle it
      // Browser stays open for research sessions
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
    let text = "";
    
    try {
      // Open URL or navigate if browser already open
      if (!this.browserOpen) {
        execFileSync("agent-browser", ["open", url], {
          encoding: "utf-8",
          stdio: "pipe",
          timeout,
        });
        this.browserOpen = true;
      } else if (this.currentUrl !== url) {
        execFileSync("agent-browser", ["open", url], {
          encoding: "utf-8",
          stdio: "pipe",
          timeout,
        });
      }
      this.currentUrl = url;
      
      // Wait for load
      execFileSync("agent-browser", ["wait", "--load", waitFor], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout,
      });
      
      // Get text from body
      text = execFileSync("agent-browser", ["get", "text", "body"], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout,
      });
      
      // Reset idle timer
      this.resetCloseTimer();
    } finally {
      // Don't close browser - let idle timer handle it
    }
    
    return text;
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
