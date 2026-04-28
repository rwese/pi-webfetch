// pi-webfetch extension - main entry point

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export type { WebfetchDetails, FetchResult, ExtractResult, ProviderConfig, ProviderCapabilities, URLDetection, ProviderFetchResult, WebfetchProvider } from "./types.js";

// Fetch functions
import { fetchUrl, webfetchSPA, downloadFile, getProviderStatus } from "./fetch.js";
export { fetchUrl, webfetchSPA, downloadFile, getProviderStatus };

// HTML utilities
export { extractMainContent, detectLikelySPA, convertToMarkdown } from "./html.js";

// Markdown post-processing
export { removeMarkdownAnchors, extractEmbeddedImages, stripEmbeddedImages } from "./markdown.js";

// Content type detection
export { isBrowserAvailable, isTextContentType, isBinaryContentType, getExtensionFromContentType } from "./content-types.js";

// Helpers
export { isLikelyBinaryUrl, convertGitHubToRaw, getTempFilePath, formatBytes, truncateToSize } from "./helpers.js";

// Constants
export const MAX_MARKDOWN_SIZE = 100 * 1024;

// ============================================================================
// pi Extension Setup
// ============================================================================

export default function (pi: ExtensionAPI): void {
	// Register tools
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description: "Fetch and process web pages from URLs",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch" }),
			provider: Type.Optional(
				Type.Union([Type.Literal("default"), Type.Literal("clawfetch")], {
					description: "Force specific provider",
				})
			),
		}),
		async execute(_toolCallId, params, _signal) {
			const result = await fetchUrl(params.url, undefined, params.provider);
			return result;
		},
	});

	pi.registerTool({
		name: "webfetch-spa",
		label: "Web Fetch SPA",
		description: "Fetch SPA/JS-heavy pages with browser rendering",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch" }),
			waitFor: Type.Optional(
				Type.Union([Type.Literal("networkidle"), Type.Literal("domcontentloaded")], {
					description: "Wait strategy",
				})
			),
			timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default: 30000)" })),
		}),
		async execute(_toolCallId, params, _signal) {
			return await webfetchSPA(params.url, params.waitFor ?? "networkidle", params.timeout ?? 30000);
		},
	});

	pi.registerTool({
		name: "download-file",
		label: "Download File",
		description: "Download a file from URL to temp location",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to download" }),
		}),
		async execute(_toolCallId, params, _signal) {
			const result = await downloadFile(params.url);
			return {
				content: [{ type: "text", text: `File saved to: ${result.tempPath}` }],
				details: { url: params.url, tempPath: result.tempPath, contentType: result.contentType },
			};
		},
	});

	pi.registerTool({
		name: "webfetch-providers",
		label: "Web Fetch Providers",
		description: "Get status of available web fetch providers",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal) {
			const providers = await getProviderStatus();
			const lines = [
				"## Web Fetch Providers",
				"",
				"| Provider | Available | Priority |",
				"|----------|-----------|----------|",
			];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? "✅ Available" : "❌ Not installed";
				lines.push(`| ${p.name} | ${status} | ${p.priority} |`);
			}

			lines.push("");
			lines.push("### Installation");
			lines.push("```bash");
			lines.push("npm i -g agent-browser && agent-browser install  # Default provider");
			lines.push("npm install -g clawfetch                         # Alternative with fast-paths");
			lines.push("```");

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { providers },
			};
		},
	});

	// Register command
	pi.registerCommand("webfetch:info", {
		description: "Show webfetch provider status and installation",
		handler: async (_args, ctx) => {
			const providers = await getProviderStatus();
			const available = providers.filter((p) => p.available);

			const lines = [
				"# 📡 webfetch Providers",
				"",
				"## Status",
				"",
			];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? "✅ Installed" : "❌ Missing";
				const features = p.name === "default" ? "agent-browser" : "clawfetch";
				lines.push(`- **${p.name}** (${features}): ${status}`);
			}

			if (available.length === 0) {
				lines.push(
					"",
					"## Installation",
					"",
					"```bash",
					"# agent-browser (default)",
					"npm i -g agent-browser && agent-browser install",
					"",
					"# clawfetch (with GitHub/Reddit fast-paths)",
					"npm install -g clawfetch",
					"```"
				);
				lines.push("", "⚠️ No providers installed - HTML pages will use static fetch.");
			} else {
				lines.push("", `✅ ${available.length} provider(s) ready`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
