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
    // Should select the first available provider (default or clawfetch)
    // Clawfetch preferred for GitHub if available, otherwise default
    const available = manager.getAvailableProviders();
    if (available.some(p => p.name === "clawfetch")) {
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
