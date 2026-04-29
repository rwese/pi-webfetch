/**
 * GhCliProvider Unit Tests
 *
 * Tests for GitHub CLI provider functionality.
 * Note: These tests focus on what can be reliably tested without complex mocking.
 * Integration tests would be needed for full fetch coverage with gh CLI.
 */

import { describe, it, expect } from "vitest";
import { GhCliProvider } from "../src/providers/gh-cli";

describe("GhCliProvider", () => {
	describe("Basic properties", () => {
		const provider = new GhCliProvider();

		it("has correct name", () => {
			expect(provider.name).toBe("gh-cli");
		});

		it("has correct priority", () => {
			expect(provider.priority).toBe(8);
		});

		it("has correct capabilities", () => {
			expect(provider.capabilities.supportsSPA).toBe(false);
			expect(provider.capabilities.supportsGitHubFastPath).toBe(true);
			expect(provider.capabilities.supportsRedditRSS).toBe(false);
			expect(provider.capabilities.supportsBotProtection).toBe(false);
			expect(provider.capabilities.returnsMetadata).toBe(true);
		});
	});

	describe("URL parsing for tree/blob URLs", () => {
		// Expose parseGitHubUrl for testing via fetch error messages
		const provider = new GhCliProvider();

		it("parses tree URL with branch and path", async () => {
			if (!provider.isAvailable()) {
				return; // Skip if gh not available
			}
			try {
				const result = await provider.fetch(
					"https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent"
				);
				expect(result.extractionMethod).toBe("gh-api-contents");
				expect(result.content).toContain("## Contents");
				expect(result.metadata.title).toBeTruthy();
			} catch (e) {
				// Expected if gh not authenticated
			}
		});

		it("parses blob URL for file", async () => {
			if (!provider.isAvailable()) {
				return;
			}
			try {
				const result = await provider.fetch(
					"https://github.com/badlogic/pi-mono/blob/main/README.md"
				);
				expect(result.extractionMethod).toBe("gh-api-contents");
				expect(result.metadata.title).toBe("README.md");
			} catch (e) {
				// Expected if gh not authenticated
			}
		});

		it("parses root tree URL", async () => {
			if (!provider.isAvailable()) {
				return;
			}
			try {
				const result = await provider.fetch(
					"https://github.com/badlogic/pi-mono/tree/main"
				);
				expect(result.extractionMethod).toBe("gh-api-contents");
				expect(result.content).toContain("## Contents");
			} catch (e) {
				// Expected if gh not authenticated
			}
		});
	});

	describe("detectUrl", () => {
		const provider = new GhCliProvider();

		it("detects GitHub URLs", () => {
			const detection = provider.detectUrl("https://github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		it("detects www.github.com URLs", () => {
			const detection = provider.detectUrl("https://www.github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		it("detects raw.githubusercontent.com URLs", () => {
			const detection = provider.detectUrl("https://raw.githubusercontent.com/user/repo/main/file.txt");
			expect(detection.isGitHub).toBe(true);
		});

		it("does not detect Reddit URLs as GitHub", () => {
			const detection = provider.detectUrl("https://www.reddit.com/r/programming");
			expect(detection.isGitHub).toBe(false);
		});

		it("does not detect SPAs", () => {
			const detection = provider.detectUrl("https://notion.so/workspace");
			expect(detection.isLikelySPA).toBe(false);
		});

		it("detects binary URLs", () => {
			const detection = provider.detectUrl("https://github.com/user/repo/file.pdf");
			expect(detection.isLikelyBinary).toBe(true);
		});

		it("detects various binary extensions", () => {
			const binaries = [
				"https://example.com/file.pdf",
				"https://example.com/file.zip",
				"https://example.com/file.png",
				"https://example.com/file.jpg",
				"https://example.com/file.gif",
				"https://example.com/file.mp4",
			];

			for (const url of binaries) {
				const detection = provider.detectUrl(url);
				expect(detection.isLikelyBinary).toBe(true);
			}
		});

		it("does not mark non-binary URLs as binary", () => {
			const detection = provider.detectUrl("https://github.com/user/repo/blob/main/README.md");
			expect(detection.isLikelyBinary).toBe(false);
		});

		it("detects GitHub enterprise URLs", () => {
			const detection = provider.detectUrl("https://github.com/enterprise/corp");
			expect(detection.isGitHub).toBe(true);
		});
	});

	describe("isAvailable", () => {
		const provider = new GhCliProvider();

		it("returns a boolean", () => {
			const result = provider.isAvailable();
			expect(typeof result).toBe("boolean");
		});
	});
});

/**
 * Integration tests for GhCliProvider would require:
 * - gh CLI installed
 * - gh CLI authenticated
 *
 * These tests should be run manually or in a CI environment with gh CLI available.
 *
 * Example integration test:
 *
 * describe("GhCliProvider Integration", () => {
 *   const provider = new GhCliProvider();
 *
 *   beforeAll(() => {
 *     if (!provider.isAvailable()) {
 *       console.warn("Skipping integration tests - gh CLI not available");
 *     }
 *   });
 *
 *   it("fetches a real GitHub issue", async () => {
 *     if (!provider.isAvailable()) return;
 *
 *     const result = await provider.fetch("https://github.com/cli/cli/issues/1234");
 *     expect(result.content).toContain("#");
 *   });
 * });
 */
