/**
 * Provider Fallback Chain Tests
 *
 * Tests for the provider manager's fallback behavior when providers fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderManager } from "../src/providers/manager";
import type { WebfetchProvider, ProviderFetchResult, ProviderConfig } from "../src/providers/types";

describe("ProviderManager - Fallback Chain", () => {
	describe("fetch with single available provider", () => {
		it("returns success when primary provider succeeds", async () => {
			// Create a mock provider that always succeeds
			const mockProvider: WebfetchProvider = {
				name: "mock-primary",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Success content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				content: "Success content",
			});
			expect(mockProvider.fetch).toHaveBeenCalledWith("https://example.com", undefined);
		});
	});

	describe("fetch with all providers failing", () => {
		it("returns error with all attempted providers listed", async () => {
			// Create two mock providers that always fail
			const mockProvider1: WebfetchProvider = {
				name: "mock-fail-1",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue(new Error("Provider 1 failed")),
			};

			const mockProvider2: WebfetchProvider = {
				name: "mock-fail-2",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue(new Error("Provider 2 failed")),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider1);
			manager.register(mockProvider2);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				success: false,
				error: "Provider 1 failed",
				attemptedProviders: ["mock-fail-1", "mock-fail-2"],
			});
			expect(mockProvider1.fetch).toHaveBeenCalled();
			expect(mockProvider2.fetch).toHaveBeenCalled();
		});

		it("stops trying after a provider succeeds", async () => {
			// First provider fails, second succeeds
			const mockProvider1: WebfetchProvider = {
				name: "mock-fail",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue(new Error("Failed")),
			};

			const mockProvider2: WebfetchProvider = {
				name: "mock-success",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Fallback success",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider1);
			manager.register(mockProvider2);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				content: "Fallback success",
			});
			expect(mockProvider1.fetch).toHaveBeenCalled();
			expect(mockProvider2.fetch).toHaveBeenCalled();
		});
	});

	describe("fetch with unavailable primary provider", () => {
		it("falls back to next available provider", async () => {
			// Primary is unavailable, fallback succeeds
			const mockPrimary: WebfetchProvider = {
				name: "mock-primary",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => false, // Not available!
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Should not be called",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const mockFallback: WebfetchProvider = {
				name: "mock-fallback",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Fallback worked",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockPrimary);
			manager.register(mockFallback);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				content: "Fallback worked",
			});
			// Primary should not be called since it's not available
			expect(mockPrimary.fetch).not.toHaveBeenCalled();
			expect(mockFallback.fetch).toHaveBeenCalled();
		});
	});

	describe("no providers available", () => {
		it("returns appropriate error when no providers available", async () => {
			const mockUnavailable: WebfetchProvider = {
				name: "mock-unavailable",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => false, // Not available
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn(),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockUnavailable);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				success: false,
				error: "No suitable provider available",
				attemptedProviders: [],
			});
			expect(mockUnavailable.fetch).not.toHaveBeenCalled();
		});
	});

	describe("forced provider selection", () => {
		it("uses forced provider when available", async () => {
			const mockPrimary: WebfetchProvider = {
				name: "primary",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Primary content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const mockForced: WebfetchProvider = {
				name: "forced",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Forced content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [], forcedProvider: "forced" });
			manager.register(mockPrimary);
			manager.register(mockForced);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				content: "Forced content",
			});
			// Primary should not be called since forced provider is used
			expect(mockPrimary.fetch).not.toHaveBeenCalled();
			expect(mockForced.fetch).toHaveBeenCalled();
		});

		it("falls back when forced provider is unavailable", async () => {
			const mockPrimary: WebfetchProvider = {
				name: "primary",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Primary content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const mockForced: WebfetchProvider = {
				name: "forced",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => false, // Forced but unavailable!
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn(),
			};

			const manager = new ProviderManager({ enabledProviders: [], forcedProvider: "forced" });
			manager.register(mockPrimary);
			manager.register(mockForced);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				content: "Primary content",
			});
			expect(mockForced.fetch).not.toHaveBeenCalled();
			expect(mockPrimary.fetch).toHaveBeenCalled();
		});
	});

	describe("provider config option", () => {
		it("uses provider from config option", async () => {
			const mockPrimary: WebfetchProvider = {
				name: "primary",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Primary content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const mockConfigProvider: WebfetchProvider = {
				name: "config-provider",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockResolvedValue({
					content: "Config provider content",
					metadata: {},
					finalUrl: "https://example.com",
					status: 200,
					contentType: "text/html",
					extractionMethod: "test",
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockPrimary);
			manager.register(mockConfigProvider);

			const result = await manager.fetch("https://example.com", { provider: "config-provider" });

			expect(result).toMatchObject({
				content: "Config provider content",
			});
			expect(mockPrimary.fetch).not.toHaveBeenCalled();
			expect(mockConfigProvider.fetch).toHaveBeenCalled();
		});
	});

	describe("provider priority ordering", () => {
		it("tries higher priority providers first", async () => {
			const callOrder: string[] = [];

			const mockLowPriority: WebfetchProvider = {
				name: "low-priority",
				priority: 1,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockImplementation(async () => {
					callOrder.push("low-priority");
					throw new Error("Low priority failed");
				}),
			};

			const mockMidPriority: WebfetchProvider = {
				name: "mid-priority",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockImplementation(async () => {
					callOrder.push("mid-priority");
					throw new Error("Mid priority failed");
				}),
			};

			const mockHighPriority: WebfetchProvider = {
				name: "high-priority",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockImplementation(async () => {
					callOrder.push("high-priority");
					throw new Error("High priority failed");
				}),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockLowPriority);
			manager.register(mockMidPriority);
			manager.register(mockHighPriority);

			await manager.fetch("https://example.com");

			// High priority should be tried first
			expect(callOrder[0]).toBe("high-priority");
			// Mid priority should be tried second
			expect(callOrder[1]).toBe("mid-priority");
			// Low priority should be tried last
			expect(callOrder[2]).toBe("low-priority");
		});
	});

	describe("error message preservation", () => {
		it("preserves the first error message when all providers fail", async () => {
			const mockProvider1: WebfetchProvider = {
				name: "error-provider-1",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue(new Error("First error message")),
			};

			const mockProvider2: WebfetchProvider = {
				name: "error-provider-2",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue(new Error("Second error message")),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider1);
			manager.register(mockProvider2);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				success: false,
				error: "First error message",
				attemptedProviders: ["error-provider-1", "error-provider-2"],
			});
		});

		it("handles non-Error thrown values", async () => {
			const mockProvider: WebfetchProvider = {
				name: "weird-error-provider",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn().mockRejectedValue("String error"),
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider);

			const result = await manager.fetch("https://example.com");

			expect(result).toMatchObject({
				success: false,
				error: "String error",
				attemptedProviders: ["weird-error-provider"],
			});
		});
	});

	describe("closeAll cleanup", () => {
		it("closes all providers with close method", async () => {
			const closeMock1 = vi.fn().mockResolvedValue(undefined);
			const closeMock2 = vi.fn().mockResolvedValue(undefined);

			const mockProvider1: WebfetchProvider = {
				name: "closeable-1",
				priority: 10,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn(),
				close: closeMock1,
			};

			const mockProvider2: WebfetchProvider = {
				name: "closeable-2",
				priority: 5,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn(),
				close: closeMock2,
			};

			const mockProvider3: WebfetchProvider = {
				name: "non-closeable",
				priority: 1,
				capabilities: {
					supportsSPA: true,
					supportsGitHubFastPath: false,
					supportsRedditRSS: false,
					supportsBotProtection: false,
					returnsMetadata: false,
				},
				isAvailable: () => true,
				detectUrl: () => ({ isGitHub: false, isReddit: false, isLikelySPA: false, isLikelyBinary: false }),
				fetch: vi.fn(),
				// No close method
			};

			const manager = new ProviderManager({ enabledProviders: [] });
			manager.register(mockProvider1);
			manager.register(mockProvider2);
			manager.register(mockProvider3);

			await manager.closeAll();

			expect(closeMock1).toHaveBeenCalled();
			expect(closeMock2).toHaveBeenCalled();
		});
	});
});
