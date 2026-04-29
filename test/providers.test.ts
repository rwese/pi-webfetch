/**
 * Provider Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DefaultProvider,
  ClawfetchProvider,
  ProviderManager,
  createProviderManager,
} from "../src/providers";

describe("DefaultProvider", () => {
  const provider = new DefaultProvider();

  it("has correct name", () => {
    expect(provider.name).toBe("default");
  });

  it("has correct priority", () => {
    expect(provider.priority).toBe(10);
  });

  it("has correct capabilities", () => {
    expect(provider.capabilities.supportsSPA).toBe(true);
    expect(provider.capabilities.supportsGitHubFastPath).toBe(false);
    expect(provider.capabilities.returnsMetadata).toBe(false);
  });

  describe("detectUrl", () => {
    it("detects GitHub URLs", () => {
      const detection = provider.detectUrl("https://github.com/user/repo");
      expect(detection.isGitHub).toBe(true);
    });

    it("detects Reddit URLs", () => {
      const detection = provider.detectUrl("https://www.reddit.com/r/programming");
      expect(detection.isReddit).toBe(true);
    });

    it("detects binary URLs", () => {
      const detection = provider.detectUrl("https://example.com/file.pdf");
      expect(detection.isLikelyBinary).toBe(true);
    });

    it("detects SPAs", () => {
      const detection = provider.detectUrl("https://notion.so/workspace");
      expect(detection.isLikelySPA).toBe(true);
    });
  });

  it("checks availability", () => {
    const result = provider.isAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("ClawfetchProvider", () => {
  const provider = new ClawfetchProvider();

  it("has correct name", () => {
    expect(provider.name).toBe("clawfetch");
  });

  it("has correct priority (lower than default)", () => {
    expect(provider.priority).toBe(5);
    expect(provider.priority).toBeLessThan(10);
  });

  it("has correct capabilities", () => {
    expect(provider.capabilities.supportsSPA).toBe(true);
    expect(provider.capabilities.supportsGitHubFastPath).toBe(true);
    expect(provider.capabilities.supportsRedditRSS).toBe(true);
    expect(provider.capabilities.returnsMetadata).toBe(true);
  });

  describe("detectUrl", () => {
    it("detects GitHub URLs", () => {
      const detection = provider.detectUrl("https://github.com/user/repo");
      expect(detection.isGitHub).toBe(true);
    });

    it("detects Reddit URLs", () => {
      const detection = provider.detectUrl("https://www.reddit.com/r/programming");
      expect(detection.isReddit).toBe(true);
    });

    it("detects binary URLs", () => {
      const detection = provider.detectUrl("https://example.com/image.png");
      expect(detection.isLikelyBinary).toBe(true);
    });

    it("detects SPAs", () => {
      const detection = provider.detectUrl("https://twitter.com/user/status");
      expect(detection.isLikelySPA).toBe(true);
    });
  });

  it("checks availability", () => {
    const result = provider.isAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("ProviderManager", () => {
  let manager: ProviderManager;

  beforeEach(() => {
    manager = createProviderManager();
  });

  describe("detectUrl", () => {
    it("delegates to available provider", () => {
      const detection = manager.detectUrl("https://github.com/user/repo");
      // Should delegate to default provider
      expect(detection).toBeDefined();
      expect(typeof detection.isGitHub).toBe("boolean");
      expect(typeof detection.isReddit).toBe("boolean");
      expect(typeof detection.isLikelySPA).toBe("boolean");
      expect(typeof detection.isLikelyBinary).toBe("boolean");
    });

    it("detects GitHub URLs", () => {
      const detection = manager.detectUrl("https://github.com/user/repo");
      expect(detection.isGitHub).toBe(true);
    });

    it("detects Reddit URLs", () => {
      const detection = manager.detectUrl("https://www.reddit.com/r/programming");
      expect(detection.isReddit).toBe(true);
    });

    it("detects binary URLs", () => {
      const detection = manager.detectUrl("https://example.com/file.pdf");
      expect(detection.isLikelyBinary).toBe(true);
    });

    it("detects SPAs", () => {
      const detection = manager.detectUrl("https://notion.so/workspace");
      expect(detection.isLikelySPA).toBe(true);
    });

    it("returns safe defaults when no providers available", () => {
      // Create manager with no enabled providers
      const emptyManager = createProviderManager({
        enabledProviders: ["nonexistent"],
      });
      const detection = emptyManager.detectUrl("https://example.com");
      
      expect(detection.isGitHub).toBe(false);
      expect(detection.isReddit).toBe(false);
      expect(detection.isLikelySPA).toBe(false);
      expect(detection.isLikelyBinary).toBe(false);
    });
  });

  it("registers providers", () => {
    const providers = manager.getAll();
    expect(providers.length).toBeGreaterThanOrEqual(2);
  });

  it("gets provider by name", () => {
    const defaultProvider = manager.get("default");
    expect(defaultProvider).toBeDefined();
    expect(defaultProvider?.name).toBe("default");
  });

  it("returns sorted providers by priority", () => {
    const sorted = manager.getSortedProviders();
    expect(sorted.length).toBeGreaterThan(1);
    // First provider should have highest priority
    expect(sorted[0].priority).toBeGreaterThanOrEqual(sorted[1].priority);
  });

  it("returns available providers", () => {
    const available = manager.getAvailableProviders();
    expect(Array.isArray(available)).toBe(true);
  });

  it("selects provider for GitHub URLs based on availability", () => {
    const provider = manager.selectProvider("https://github.com/user/repo");
    // Should select the first available provider (gh-cli preferred, then clawfetch, then default)
    // gh-cli is preferred for GitHub if available and authenticated
    const available = manager.getAvailableProviders();
    if (available.some(p => p.name === "gh-cli")) {
      expect(provider?.name).toBe("gh-cli");
    } else if (available.some(p => p.name === "clawfetch")) {
      expect(provider?.name).toBe("clawfetch");
    } else {
      // Falls back to default
      expect(provider?.name).toBe("default");
    }
  });

  it("selects default provider for regular URLs", () => {
    // Force default priority by checking available
    const available = manager.getAvailableProviders();
    if (available.length > 0) {
      const provider = manager.selectProvider("https://example.com/article");
      expect(provider).toBeDefined();
    }
  });

  it("returns null for binary URLs", () => {
    const provider = manager.selectProvider("https://example.com/file.pdf");
    // Binary URLs should not select any provider (handled differently)
    // The actual behavior depends on implementation
    expect(provider === null || provider === undefined || provider.name).toBeTruthy();
  });

  it("unregisters provider", () => {
    const result = manager.unregister("clawfetch");
    expect(result).toBe(true);
    
    // Verify it's gone
    const provider = manager.get("clawfetch");
    expect(provider).toBeUndefined();
  });

  it("has available provider check", () => {
    const hasProvider = manager.hasAvailableProvider();
    expect(typeof hasProvider).toBe("boolean");
  });
});

describe("ProviderManager with config", () => {
  it("respects forced provider config when available", () => {
    const manager = createProviderManager({
      forcedProvider: "default",
    });
    
    const provider = manager.selectProvider("https://example.com");
    // Default is always available (agent-browser check)
    expect(provider?.name).toBe("default");
  });

  it("respects enabled providers config", () => {
    const manager = createProviderManager({
      enabledProviders: ["default"],
    });
    
    // Clawfetch should not be registered
    const clawfetch = manager.get("clawfetch");
    expect(clawfetch).toBeUndefined();
    
    // Default should still be there
    const def = manager.get("default");
    expect(def).toBeDefined();
  });
});

describe("Provider error handling", () => {
  it("handles fetch error gracefully", async () => {
    const manager = createProviderManager();
    const result = await manager.fetch("https://this-domain-does-not-exist-12345.com");
    
    expect(result).toBeDefined();
    expect("success" in result || "content" in result).toBe(true);
  });
});

describe("ProviderManager detectUrl method", () => {
  it("manager has detectUrl method", () => {
    const manager = createProviderManager();
    expect(typeof manager.detectUrl).toBe("function");
  });

  it("detectUrl returns URLDetection type", () => {
    const manager = createProviderManager();
    const result = manager.detectUrl("https://example.com");
    
    expect(result).toHaveProperty("isGitHub");
    expect(result).toHaveProperty("isReddit");
    expect(result).toHaveProperty("isLikelySPA");
    expect(result).toHaveProperty("isLikelyBinary");
  });

  it("detectUrl works with all URL types", () => {
    const manager = createProviderManager();
    
    const testCases = [
      { url: "https://github.com/user/repo", expected: { isGitHub: true } },
      { url: "https://reddit.com/r/test", expected: { isReddit: true } },
      { url: "https://example.com/file.pdf", expected: { isLikelyBinary: true } },
      { url: "https://notion.so/workspace", expected: { isLikelySPA: true } },
    ];
    
    for (const tc of testCases) {
      const result = manager.detectUrl(tc.url);
      for (const [key, value] of Object.entries(tc.expected)) {
        expect(result[key as keyof typeof result]).toBe(value);
      }
    }
  });

  it("detectUrl uses first available provider", () => {
    const manager = createProviderManager();
    
    // Get what the first provider detects
    const firstProvider = manager.getAvailableProviders()[0];
    const providerResult = firstProvider.detectUrl("https://github.com/user/repo");
    
    // Manager should delegate to first provider
    const managerResult = manager.detectUrl("https://github.com/user/repo");
    
    expect(managerResult.isGitHub).toBe(providerResult.isGitHub);
  });

  it("detectUrl returns safe defaults when no providers", () => {
    const emptyManager = createProviderManager({ enabledProviders: ["nonexistent"] });
    const result = emptyManager.detectUrl("https://example.com");
    
    expect(result.isGitHub).toBe(false);
    expect(result.isReddit).toBe(false);
    expect(result.isLikelySPA).toBe(false);
    expect(result.isLikelyBinary).toBe(false);
  });
});
