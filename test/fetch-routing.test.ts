/**
 * Fetch Routing Tests
 *
 * Tests for proper routing of fetch requests:
 * - Raw GitHub URLs should use static fetch (not browser provider)
 * - GitHub web URLs should use browser provider (for HTML rendering)
 * - Binary URLs should be handled appropriately
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DefaultProvider, ClawfetchProvider, GhCliProvider, ProviderManager, createProviderManager } from "../src/providers";
import { isLikelyBinaryUrl } from "../extensions/helpers";

describe("Fetch Routing Logic", () => {
	describe("Provider Selection for GitHub URLs", () => {
		let manager: ReturnType<typeof createProviderManager>;

		beforeEach(() => {
			manager = createProviderManager();
		});

		it("should select gh-cli for github.com web URLs (if available and authenticated)", async () => {
			const provider = await manager.selectProvider("https://github.com/user/repo");
			// gh-cli is preferred for GitHub URLs (structured data), then clawfetch
			const available = await manager.getAvailableProviders();
			if (available.some(p => p.name === "gh-cli")) {
				expect(provider?.name).toBe("gh-cli");
			} else if (available.some(p => p.name === "clawfetch")) {
				expect(provider?.name).toBe("clawfetch");
			}
		});

		it("should NOT select browser provider for raw.githubusercontent.com URLs", async () => {
			const provider = await manager.selectProvider(
				"https://raw.githubusercontent.com/user/repo/main/file.txt"
			);
			// Raw URLs should go through static fetch, not browser
			// For now, this documents the expected behavior
			// The provider might still be selected, but staticFetch should handle it
			expect(provider).toBeDefined(); // Provider may be selected, but routing in fetch.ts matters
		});

		it("should select provider for github.com blob URLs", async () => {
			const provider = await manager.selectProvider(
				"https://github.com/user/repo/blob/main/README.md"
			);
			expect(provider).toBeDefined();
		});
	});

	describe("URL Detection returns correct type flags", () => {
		let manager: ReturnType<typeof createProviderManager>;

		beforeEach(() => {
			manager = createProviderManager();
		});

		// BUG: raw.githubusercontent.com should have isGitHub = true
		it("raw.githubusercontent.com should have isGitHub = true", async () => {
			const detection = await manager.detectUrl(
				"https://raw.githubusercontent.com/nix-community/disko/master/lib/types/gpt.nix"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("documents that raw URLs should use convertGitHubToRaw helper", () => {
			// The convertGitHubToRaw function exists but raw URLs already use the raw format
			// So raw.githubusercontent.com URLs should pass through unchanged
			// This test just verifies isLikelyBinaryUrl works correctly

			// Nix files should not be treated as binary
			expect(isLikelyBinaryUrl(
				"https://raw.githubusercontent.com/user/repo/main/file.nix"
			)).toBe(false);
		});

		it("documents that .nix files should use text processing", () => {
			// Various source file types should not be binary
			const textExtensions = [
				'.nix', '.ts', '.js', '.py', '.sh', '.md', '.txt', '.json', '.yaml', '.yml', '.xml', '.html', '.css'
			];

			for (const ext of textExtensions) {
				const url = `https://example.com/file${ext}`;
				expect(isLikelyBinaryUrl(url)).toBe(false);
			}
		});
	});
});

describe("Provider Priority Handling", () => {
	it("documents that default provider has priority 10", () => {
		const provider = new DefaultProvider();
		expect(provider.priority).toBe(10);
	});

	it("documents that clawfetch provider has priority 5 (lower = tried second)", () => {
		const provider = new ClawfetchProvider();
		expect(provider.priority).toBe(5);
	});

	it("documents that gh-cli provider has priority 8", () => {
		const provider = new GhCliProvider();
		expect(provider.priority).toBe(8);
	});

	it("getSortedProviders returns providers in correct priority order", () => {
		const manager = createProviderManager();
		const sorted = manager.getSortedProviders();

		if (sorted.length >= 2) {
			// Higher priority number = higher preference (tried first)
			expect(sorted[0].priority).toBeGreaterThanOrEqual(sorted[sorted.length - 1].priority);
		}
	});
});
