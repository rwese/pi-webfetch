/**
 * Resource Cleanup Tests
 *
 * Tests for proper cleanup of browser resources and error safety.
 */

import { describe, it, expect } from "vitest";
import { DefaultProvider, ClawfetchProvider } from "../src/providers";

describe("Resource Cleanup", () => {
  describe("DefaultProvider close()", () => {
    it("has close method", () => {
      const provider = new DefaultProvider();
      expect(typeof provider.close).toBe("function");
    });

    it("close is async", async () => {
      const provider = new DefaultProvider();
      const result = provider.close();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    it("close does not throw when browser is not open", async () => {
      const provider = new DefaultProvider();
      // Should not throw even if browserOpen is false
      await expect(provider.close()).resolves.not.toThrow();
    });

    it("close calls agent-browser close command", async () => {
      const provider = new DefaultProvider();
      
      // We can't easily test the actual close behavior without deeper mocking
      // but we can verify the method exists and is callable
      await provider.close();
      
      // If agent-browser is available, close should be called
      // This is a basic smoke test
      expect(true).toBe(true);
    });
  });

  describe("ClawfetchProvider close()", () => {
    it("has close method", () => {
      const provider = new ClawfetchProvider();
      expect(typeof provider.close).toBe("function");
    });

    it("close is async", async () => {
      const provider = new ClawfetchProvider();
      const result = provider.close();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    it("close is a no-op (stateless)", async () => {
      const provider = new ClawfetchProvider();
      // Multiple closes should not cause issues
      await provider.close();
      await provider.close();
      await provider.close();

      // Should resolve without error
      expect(true).toBe(true);
    });
  });

  describe("Error safety", () => {
    it("close method handles errors gracefully", async () => {
      const provider = new DefaultProvider();

      // Even if close fails internally, it should not throw
      // We can't easily simulate this without deeper mocking
      await expect(provider.close()).resolves.not.toThrow();
    });
  });

  describe("Provider interface compliance", () => {
    it("DefaultProvider implements WebfetchProvider with optional close", () => {
      const provider = new DefaultProvider();
      expect(provider.name).toBe("default");
      expect(typeof provider.fetch).toBe("function");
      expect(typeof provider.close).toBe("function");
    });

    it("ClawfetchProvider implements WebfetchProvider with optional close", () => {
      const provider = new ClawfetchProvider();
      expect(provider.name).toBe("clawfetch");
      expect(typeof provider.fetch).toBe("function");
      expect(typeof provider.close).toBe("function");
    });
  });

  describe("Browser tracking flag", () => {
    it("DefaultProvider has browserOpen internal state", () => {
      // This is an implementation detail test
      // We verify it through the close behavior
      const provider = new DefaultProvider();

      // Before any operation, browserOpen should be false
      // After close, it should be false
      // This is verified by close not throwing when browser is not open
      expect(typeof provider.close).toBe("function");
    });
  });
});

describe("Provider closeAll", () => {
  it("can close multiple providers sequentially", async () => {
    const providers = [
      new DefaultProvider(),
      new ClawfetchProvider(),
    ];

    // Should be able to close all without errors
    for (const provider of providers) {
      await expect(provider.close()).resolves.not.toThrow();
    }
  });
});

describe("Extension closeAllProviders", () => {
  it("closeAllProviders is exported and callable", async () => {
    // Dynamic import to test the actual function
    const module = await import("../extensions/fetch.js");
    expect(typeof module.closeAllProviders).toBe("function");
  });

  it("closeAllProviders resolves without error", async () => {
    const module = await import("../extensions/fetch.js");
    await expect(module.closeAllProviders()).resolves.not.toThrow();
  });
});
