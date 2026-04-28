/**
 * URL Detection Tests
 *
 * Tests for proper detection of URL types to route fetch requests correctly.
 * Raw GitHub URLs should be detected as GitHub URLs for proper static fetch handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DefaultProvider, ClawfetchProvider, ProviderManager, createProviderManager } from "../src/providers";

describe("DefaultProvider URL Detection", () => {
	const provider = new DefaultProvider();

	describe("detectUrl", () => {
		it("detects github.com URLs", () => {
			const detection = provider.detectUrl("https://github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		it("detects www.github.com URLs", () => {
			const detection = provider.detectUrl("https://www.github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		// BUG: raw.githubusercontent.com is NOT detected as GitHub URL
		it("detects raw.githubusercontent.com as GitHub URL", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/user/repo/main/file.nix"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("detects raw.githubusercontent.com with branch paths", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/nix-community/disko/master/lib/types/gpt.nix"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("does not flag raw URLs as SPA", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/user/repo/main/file.txt"
			);
			expect(detection.isLikelySPA).toBe(false);
		});
	});
});

describe("ClawfetchProvider URL Detection", () => {
	const provider = new ClawfetchProvider();

	describe("detectUrl", () => {
		it("detects github.com URLs", () => {
			const detection = provider.detectUrl("https://github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		// BUG: raw.githubusercontent.com is NOT detected as GitHub URL
		it("detects raw.githubusercontent.com as GitHub URL", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/user/repo/main/script.sh"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("detects raw.githubusercontent.com with nested paths", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/nix-community/disko/master/lib/types/gpt.nix"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("does not flag raw URLs as SPA", () => {
			const detection = provider.detectUrl(
				"https://raw.githubusercontent.com/org/repo/HEAD/file.txt"
			);
			expect(detection.isLikelySPA).toBe(false);
		});
	});
});

describe("ProviderManager URL Detection", () => {
	let manager: ProviderManager;

	beforeEach(() => {
		manager = createProviderManager();
	});

	describe("detectUrl", () => {
		it("delegates to available provider for github.com", () => {
			const detection = manager.detectUrl("https://github.com/user/repo");
			expect(detection.isGitHub).toBe(true);
		});

		// BUG: raw.githubusercontent.com is NOT detected as GitHub
		it("detects raw.githubusercontent.com as GitHub", () => {
			const detection = manager.detectUrl(
				"https://raw.githubusercontent.com/nix-community/disko/master/lib/types/gpt.nix"
			);
			expect(detection.isGitHub).toBe(true);
		});

		it("does not mark raw URLs as SPA", () => {
			const detection = manager.detectUrl(
				"https://raw.githubusercontent.com/user/repo/HEAD/file.txt"
			);
			expect(detection.isLikelySPA).toBe(false);
		});
	});
});
