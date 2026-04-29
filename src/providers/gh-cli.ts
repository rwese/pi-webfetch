/**
 * GitHub CLI Provider
 *
 * Uses the gh CLI for fetching GitHub content (issues, repos, etc.)
 * Falls back when no browser provider is available or as an alternative.
 */

import { execFileSync, execSync } from "node:child_process";
import {
  type WebfetchProvider,
  type ProviderFetchResult,
  type ProviderCapabilities,
  type URLDetection,
  type ProviderConfig,
  ProviderError,
} from "./types";

/**
 * GitHub CLI provider using the gh command
 */
export class GhCliProvider implements WebfetchProvider {
  readonly name = "gh-cli";
  readonly priority = 8; // Higher than clawfetch (5), lower than default (10)
  // But for GitHub URLs, it will be preferred in provider selection

  readonly capabilities: ProviderCapabilities = {
    supportsSPA: false, // Not applicable for gh CLI
    supportsGitHubFastPath: true,
    supportsRedditRSS: false,
    supportsBotProtection: false,
    returnsMetadata: true,
  };

  private ghPath: string | null = null;
  private authenticated: boolean | null = null;

  /**
   * Find gh binary and check if authenticated
   */
  private findGh(): string | null {
    if (this.ghPath !== null) {
      return this.ghPath;
    }

    const candidates = [
      "gh", // In PATH
      "/usr/local/bin/gh",
      "/usr/bin/gh",
      "/opt/homebrew/bin/gh",
    ];

    for (const candidate of candidates) {
      try {
        execFileSync(candidate, ["--version"], {
          encoding: "utf-8",
          stdio: "pipe",
        });
        this.ghPath = candidate;
        return candidate;
      } catch {
        // Try next candidate
      }
    }

    this.ghPath = null;
    return null;
  }

  /**
   * Check if gh CLI is available and authenticated
   */
  isAvailable(): boolean {
    const gh = this.findGh();
    if (!gh) {
      return false;
    }

    if (this.authenticated === null) {
      try {
        execFileSync(gh, ["auth", "status"], {
          encoding: "utf-8",
          stdio: "pipe",
        });
        this.authenticated = true;
      } catch {
        this.authenticated = false;
      }
    }

    return this.authenticated;
  }

  /**
   * Detect URL characteristics
   */
  detectUrl(url: string): URLDetection {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // GitHub URLs
    const isGitHubHost = hostname === "github.com" || hostname === "www.github.com";
    const isGitHubRaw = hostname === "raw.githubusercontent.com";

    // Check if it's an issue, PR, or repo URL
    const parts = pathname.split("/").filter(Boolean);
    const isIssueLike = parts.length >= 3 &&
      (parts[2] === "issues" || parts[2] === "pull");
    const isRepoView = isGitHubHost && parts.length >= 2;

    return {
      isGitHub: isGitHubHost || isGitHubRaw,
      isReddit: false,
      isLikelySPA: false,
      isLikelyBinary: this.checkLikelyBinary(url),
    };
  }

  /**
   * Parse GitHub URL and extract owner/repo/number
   */
  private parseGitHubUrl(url: string): { owner: string; repo: string; type: 'issue' | 'pr' | 'repo' | 'unknown'; number?: number } | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
        return null;
      }

      const parts = parsed.pathname.split("/").filter(Boolean);

      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1];

        if (parts.length === 2) {
          return { owner, repo, type: "repo" };
        }

        if (parts.length >= 3) {
          if (parts[2] === "issues" && parts.length >= 4) {
            return { owner, repo, type: "issue", number: parseInt(parts[3], 10) };
          }
          if (parts[2] === "pull" && parts.length >= 4) {
            return { owner, repo, type: "pr", number: parseInt(parts[3], 10) };
          }
          if (parts.length === 3) {
            // Could be tree, blob, etc - treat as repo view
            return { owner, repo, type: "repo" };
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Main fetch implementation using gh CLI
   */
  async fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult> {
    const gh = this.findGh();

    if (!gh) {
      throw new ProviderError(
        "gh CLI not installed. Install from: https://cli.github.com",
        this.name
      );
    }

    if (!this.authenticated) {
      throw new ProviderError(
        "gh CLI not authenticated. Run: gh auth login",
        this.name
      );
    }

    const parsed = this.parseGitHubUrl(url);

    if (!parsed) {
      throw new ProviderError(
        `Could not parse GitHub URL: ${url}`,
        this.name
      );
    }

    const repo = `${parsed.owner}/${parsed.repo}`;
    const timeout = config?.timeout || 30000;

    try {
      if (parsed.type === "issue" && parsed.number) {
        return this.fetchIssue(gh, repo, parsed.number, timeout);
      }
      if (parsed.type === "pr" && parsed.number) {
        return this.fetchPr(gh, repo, parsed.number, timeout);
      }
      if (parsed.type === "repo") {
        return this.fetchRepo(gh, repo, timeout);
      }

      throw new ProviderError(
        `Unsupported GitHub URL type: ${parsed.type}`,
        this.name
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        error instanceof Error ? error.message : String(error),
        this.name,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Fetch an issue using gh issue view
   */
  private fetchIssue(gh: string, repo: string, number: number, timeout: number): ProviderFetchResult {
    const args = [
      "issue",
      "view",
      number.toString(),
      "--repo", repo,
      "--json", "title,body,state,author,labels,assignees,createdAt,updatedAt,comments",
      "--comments",
    ];

    const output = this.execGh(gh, args, timeout);
    const data = JSON.parse(output);

    const comments = data.comments || [];
    let content = `# ${data.title || `Issue #${number}`}\n\n`;

    // Add metadata
    content += `**State:** ${data.state || "unknown"}\n`;
    content += `**Author:** ${data.author?.login || "unknown"}\n`;
    content += `**Created:** ${data.createdAt ? new Date(data.createdAt).toISOString().split('T')[0] : "unknown"}\n`;

    if (data.labels && data.labels.length > 0) {
      content += `**Labels:** ${data.labels.map((l: { name: string }) => l.name).join(", ")}\n`;
    }

    if (data.assignees && data.assignees.length > 0) {
      content += `**Assignees:** ${data.assignees.map((a: { login: string }) => a.login).join(", ")}\n`;
    }

    content += `\n---\n\n`;

    // Add body
    if (data.body) {
      content += `${data.body}\n\n`;
    }

    // Add comments
    if (comments.length > 0) {
      content += `---\n\n## Comments\n\n`;
      for (const comment of comments) {
        const date = comment.createdAt ? new Date(comment.createdAt).toISOString().split('T')[0] : "";
        content += `### @${comment.author?.login || "unknown"} (${date})\n\n`;
        content += `${comment.body}\n\n---\n\n`;
      }
    }

    return {
      content: content.trim(),
      metadata: {
        title: data.title,
        author: data.author?.login,
      },
      finalUrl: `https://github.com/${repo}/issues/${number}`,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: "gh-issue-view",
      providerName: this.name,
    };
  }

  /**
   * Fetch a PR using gh pr view
   */
  private fetchPr(gh: string, repo: string, number: number, timeout: number): ProviderFetchResult {
    const args = [
      "pr",
      "view",
      number.toString(),
      "--repo", repo,
      "--json", "title,body,state,author,additions,deletions,changedFiles,commits,reviews",
    ];

    const output = this.execGh(gh, args, timeout);
    const data = JSON.parse(output);

    let content = `# ${data.title || `PR #${number}`}\n\n`;

    // Add metadata
    content += `**State:** ${data.state || "unknown"}\n`;
    content += `**Author:** ${data.author?.login || "unknown"}\n`;
    content += `**Files changed:** ${data.changedFiles || 0}\n`;
    content += `**Additions:** +${data.additions || 0}\n`;
    content += `**Deletions:** -${data.deletions || 0}\n`;
    content += `**Commits:** ${data.commits || 0}\n`;

    content += `\n---\n\n`;

    // Add body
    if (data.body) {
      content += `${data.body}\n\n`;
    }

    return {
      content: content.trim(),
      metadata: {
        title: data.title,
        author: data.author?.login,
      },
      finalUrl: `https://github.com/${repo}/pull/${number}`,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: "gh-pr-view",
      providerName: this.name,
    };
  }

  /**
   * Fetch a repo using gh repo view
   */
  private fetchRepo(gh: string, repo: string, timeout: number): ProviderFetchResult {
    const args = [
      "repo",
      "view",
      repo,
      "--json", "name,description,owner,defaultBranchRef,stargazerCount,forkCount,openIssueCount,openPRCount,licenseInfo,languages",
    ];

    const output = this.execGh(gh, args, timeout);
    const data = JSON.parse(output);

    let content = `# ${data.name || repo}\n\n`;

    // Add metadata
    if (data.description) {
      content += `${data.description}\n\n`;
    }

    content += `**Owner:** ${data.owner?.login || "unknown"}\n`;
    content += `**Default branch:** ${data.defaultBranchRef?.name || "main"}\n`;
    content += `**Stars:** ${data.stargazerCount || 0}\n`;
    content += `**Forks:** ${data.forkCount || 0}\n`;
    content += `**Open Issues:** ${data.openIssueCount || 0}\n`;
    content += `**Open PRs:** ${data.openPRCount || 0}\n`;

    if (data.licenseInfo?.name) {
      content += `**License:** ${data.licenseInfo.name}\n`;
    }

    if (data.languages && Object.keys(data.languages).length > 0) {
      const langs = Object.entries(data.languages as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, bytes]) => `${lang} (${(bytes / 1000).toFixed(1)}k)`)
        .join(", ");
      content += `**Languages:** ${langs}\n`;
    }

    return {
      content: content.trim(),
      metadata: {
        title: data.name,
        author: data.owner?.login,
        excerpt: data.description,
      },
      finalUrl: `https://github.com/${repo}`,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: "gh-repo-view",
      providerName: this.name,
    };
  }

  /**
   * Execute gh CLI
   */
  private execGh(gh: string, args: string[], timeout: number): string {
    try {
      return execSync([gh, ...args].join(" "), {
        encoding: "utf-8",
        timeout: Math.floor(timeout / 1000),
        stdio: "pipe",
        shell: "/bin/bash",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`gh execution failed: ${message}`, this.name);
    }
  }

  /**
   * Check if URL is likely binary
   */
  private checkLikelyBinary(url: string): boolean {
    const binaryExtensions = [
      ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp",
      ".mp3", ".mp4", ".avi", ".mov", ".exe", ".dmg",
    ];

    const urlLower = url.toLowerCase();
    return binaryExtensions.some((ext) => urlLower.includes(ext));
  }
}
