/**
 * GitHub CLI Provider
 *
 * Uses the gh CLI for fetching GitHub content (issues, repos, etc.)
 * Falls back when no browser provider is available or as an alternative.
 */

import { spawn } from "node:child_process";

/**
 * Execute a command asynchronously using spawn
 */
function execAsync(
  command: string,
  args: string[],
  options: { timeout?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
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
   * Find gh binary and check if authenticated (async version)
   */
  private async findGhAsync(): Promise<string | null> {
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
        await execAsync(candidate, ["--version"]);
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
   * Check if gh CLI is available and authenticated (async version)
   */
  async isAvailable(): Promise<boolean> {
    const gh = await this.findGhAsync();
    if (!gh) {
      return false;
    }

    if (this.authenticated === null) {
      try {
        await execAsync(gh, ["auth", "status"]);
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
  private parseGitHubUrl(url: string): { owner: string; repo: string; type: 'issue' | 'pr' | 'repo' | 'tree' | 'blob' | 'unknown'; number?: number; path?: string; ref?: string } | null {
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
          if (parts[2] === "tree" && parts.length >= 4) {
            // /owner/repo/tree/{ref}/{path}
            const ref = parts[3];
            const path = parts.length > 4 ? parts.slice(4).join("/") : "";
            return { owner, repo, type: "tree", ref, path };
          }
          if (parts[2] === "blob" && parts.length >= 4) {
            // /owner/repo/blob/{ref}/{path}
            const ref = parts[3];
            const path = parts.length > 4 ? parts.slice(4).join("/") : "";
            return { owner, repo, type: "blob", ref, path };
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
    const gh = await this.findGhAsync();

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
        return await this.fetchIssue(gh, repo, parsed.number, timeout);
      }
      if (parsed.type === "pr" && parsed.number) {
        return await this.fetchPr(gh, repo, parsed.number, timeout);
      }
      if (parsed.type === "repo") {
        return await this.fetchRepo(gh, repo, timeout);
      }
      if (parsed.type === "tree") {
        return await this.fetchDirectory(gh, repo, parsed.ref || "main", parsed.path || "", timeout);
      }
      if (parsed.type === "blob") {
        return await this.fetchFile(gh, repo, parsed.ref || "main", parsed.path || "", timeout);
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
  private async fetchIssue(gh: string, repo: string, number: number, timeout: number): Promise<ProviderFetchResult> {
    const args = [
      "issue",
      "view",
      number.toString(),
      "--repo", repo,
      "--json", "title,body,state,author,labels,assignees,createdAt,updatedAt,comments",
      "--comments",
    ];

    const output = await this.execGh(gh, args, timeout);
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
  private async fetchPr(gh: string, repo: string, number: number, timeout: number): Promise<ProviderFetchResult> {
    const args = [
      "pr",
      "view",
      number.toString(),
      "--repo", repo,
      "--json", "title,body,state,author,additions,deletions,changedFiles,commits,reviews",
    ];

    const output = await this.execGh(gh, args, timeout);
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
  private async fetchRepo(gh: string, repo: string, timeout: number): Promise<ProviderFetchResult> {
    const args = [
      "repo",
      "view",
      repo,
      "--json", "name,description,owner,defaultBranchRef,stargazerCount,forkCount,openIssueCount,openPRCount,licenseInfo,languages",
    ];

    const output = await this.execGh(gh, args, timeout);
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
   * Fetch directory contents using GitHub API
   */
  private async fetchDirectory(gh: string, repo: string, ref: string, path: string, timeout: number): Promise<ProviderFetchResult> {
    const apiPath = path ? `/repos/${repo}/contents/${path}` : `/repos/${repo}/contents`;
    // Add ref as query parameter
    const fullPath = `${apiPath}?ref=${ref}`;
    const args = ["api", fullPath, "--jq", "."];
    
    const output = await this.execGh(gh, args, timeout);
    
    // The API returns an array of entries
    let entries: Array<{
      name: string;
      type: string;
      size: number;
      download_url: string | null;
      html_url: string;
    }>;
    
    try {
      entries = JSON.parse(output);
    } catch {
      // Single file returned - this is actually a file, not a directory
      // Re-fetch as a file
      return this.fetchFile(gh, repo, ref, path, timeout);
    }

    if (!Array.isArray(entries)) {
      return this.fetchFile(gh, repo, ref, path, timeout);
    }

    // Sort: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const displayPath = path || "/";
    let content = `# ${repo}/${path || ""}\n
`;
    content += `**Branch:** ${ref}\n`;
    content += `**Path:** ${displayPath}\n
`;
    content += `---\n\n`;
    content += `## Contents\n\n`;

    for (const entry of entries) {
      const icon = entry.type === "dir" ? "📁" : this.getFileIcon(entry.name);
      const size = entry.type === "file" ? ` (${this.formatSize(entry.size)})` : "";
      const link = entry.html_url.replace("github.com", "github.com");
      content += `- ${icon} [${entry.name}](${link})${size}\n`;
    }

    const finalUrl = `https://github.com/${repo}/tree/${ref}/${path}`;

    return {
      content: content.trim(),
      metadata: {
        title: path ? `${path} - ${repo}` : repo,
        excerpt: `${entries.length} items`,
      },
      finalUrl,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: "gh-api-contents",
      providerName: this.name,
    };
  }

  /**
   * Fetch file contents using GitHub API
   */
  private async fetchFile(gh: string, repo: string, ref: string, path: string, timeout: number): Promise<ProviderFetchResult> {
    const apiPath = `/repos/${repo}/contents/${path}`;
    // Add ref as query parameter
    const fullPath = `${apiPath}?ref=${ref}`;
    const args = ["api", fullPath, "--jq", "."];

    const output = await this.execGh(gh, args, timeout);
    const data = JSON.parse(output);

    const fileName = path.split("/").pop() || path;
    const isImage = this.isImageFile(fileName);
    const isMarkdown = this.isMarkdownFile(fileName);
    const isCode = this.isCodeFile(fileName);

    let content = `# ${fileName}\n
`;
    content += `**Repository:** ${repo}\n`;
    content += `**Path:** ${path}\n`;
    content += `**Branch:** ${ref}\n`;
    content += `**Size:** ${this.formatSize(data.size)}\n`;
    content += `**SHA:** ${data.sha?.slice(0, 7) || "unknown"}\n\n`;
    content += `[Open in GitHub](${data.html_url})\n\n`;
    content += `---\n\n`;

    // For images, link to raw instead of embedding
    if (isImage && data.download_url) {
      content += `![${fileName}](${data.download_url})\n\n`;
      content += `*Image: ${fileName}*\n`;
    } else if (isMarkdown || isCode || this.isTextFile(fileName)) {
      // Fetch raw content for text files
      const rawContent = await this.fetchRawContent(data.download_url, timeout);
      if (rawContent) {
        // For markdown files, include the content directly
        // For code files, wrap in a code block
        if (isMarkdown) {
          content += `## File Content\n\n`;
          content += rawContent;
        } else {
          const lang = this.getCodeLanguage(fileName);
          content += `## File Content\n\n`;
          content += `\`\`\`${lang}\n${rawContent}\n\`\`\`\n`;
        }
      }
    } else {
      content += `*Binary file: ${fileName}*\n`;
      if (data.download_url) {
        content += `\n[Download ${fileName}](${data.download_url})\n`;
      }
    }

    return {
      content: content.trim(),
      metadata: {
        title: fileName,
        excerpt: path,
      },
      finalUrl: data.html_url,
      status: 200,
      contentType: "text/markdown",
      extractionMethod: "gh-api-contents",
      providerName: this.name,
    };
  }

  /**
   * Fetch raw file content
   */
  private fetchRawContent(downloadUrl: string | null, timeout: number): Promise<string | null> {
    if (!downloadUrl) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const proc = spawn("curl", ["-sL", downloadUrl], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve(null);
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          resolve(null);
        }
      });

      proc.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  /**
   * Format file size for display
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Get icon for file based on extension
   */
  private getFileIcon(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const icons: Record<string, string> = {
      // Code
      ts: "📜", tsx: "📜", js: "📜", jsx: "📜",
      py: "🐍", rb: "💎", go: "🔵", rs: "🦀",
      java: "☕", kt: "�otlin", swift: "🍎",
      c: "🔧", cpp: "🔧", h: "🔧",
      // Config
      json: "📋", yaml: "📋", yml: "📋", toml: "📋",
      // Markup
      md: "📝", html: "🌐", css: "🎨", scss: "🎨",
      // Images
      png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️",
      // Docs
      txt: "📄", pdf: "📕", doc: "📘",
      // Archives
      zip: "📦", tar: "📦", gz: "📦",
      // Shell
      sh: "🐚", bash: "🐚", zsh: "🐚",
    };
    return icons[ext] || "📄";
  }

  /**
   * Check if file is an image
   */
  private isImageFile(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext);
  }

  /**
   * Check if file is markdown
   */
  private isMarkdownFile(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["md", "mdx", "markdown"].includes(ext);
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "swift",
            "c", "cpp", "h", "hpp", "cs", "rb", "php", "lua", "sh", "bash", "zsh",
            "json", "yaml", "yml", "toml", "xml", "sql"].includes(ext);
  }

  /**
   * Check if file is text (non-code)
   */
  private isTextFile(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["txt", "log", "ini", "cfg", "conf", "env"].includes(ext);
  }

  /**
   * Get code language for syntax highlighting
   */
  private getCodeLanguage(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const langs: Record<string, string> = {
      ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
      py: "python", go: "go", rs: "rust", java: "java",
      kt: "kotlin", swift: "swift", c: "c", cpp: "cpp",
      h: "c", hpp: "cpp", cs: "csharp", rb: "ruby",
      php: "php", lua: "lua", sh: "bash", bash: "bash",
      zsh: "bash", json: "json", yaml: "yaml", yml: "yaml",
      toml: "toml", xml: "xml", sql: "sql",
    };
    return langs[ext] || "text";
  }

  /**
   * Execute gh CLI using spawn (more reliable than execFileSync in some environments)
   */
  private async execGh(gh: string, args: string[], timeout: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(gh, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new ProviderError(`gh execution timed out after ${timeout}ms`, this.name));
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new ProviderError(`gh execution failed with code ${code}: ${stderr || stdout}`, this.name));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new ProviderError(`gh execution error: ${err.message}`, this.name));
      });
    }).catch((error) => {
      throw error instanceof ProviderError ? error : new ProviderError(error instanceof Error ? error.message : String(error), this.name);
    });
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
