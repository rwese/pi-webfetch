/**
 * Clawfetch Output Parser
 *
 * Parses clawfetch CLI output into structured results.
 */

import type { ProviderFetchResult } from "../types.js";

/** Metadata parsed from clawfetch output */
export interface ParsedMetadata {
	title?: string;
	author?: string;
	siteName?: string;
	finalUrl?: string;
	extraction?: string;
	fallbackSelector?: string;
}

/**
 * Parse clawfetch output (METADATA + MARKDOWN sections)
 */
export function parseOutput(output: string, originalUrl: string): ProviderFetchResult {
	const lines = output.split("\n");
	const metadata: ParsedMetadata = {};
	const markdownParts: string[] = [];

	let inMarkdown = false;

	for (const line of lines) {
		if (line === "--- MARKDOWN ---") {
			inMarkdown = true;
			continue;
		}

		if (line === "--- METADATA ---") {
			continue;
		}

		if (inMarkdown) {
			markdownParts.push(line);
		} else {
			// Parse metadata line: "Key: Value"
			const colonIndex = line.indexOf(":");
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim().toLowerCase();
				const value = line.slice(colonIndex + 1).trim();

				switch (key) {
					case "title":
						metadata.title = value;
						break;
					case "author":
						metadata.author = value;
						break;
					case "site":
						metadata.siteName = value;
						break;
					case "finalurl":
						metadata.finalUrl = value;
						break;
					case "extraction":
						metadata.extraction = value;
						break;
					case "fallbackselector":
						metadata.fallbackSelector = value;
						break;
				}
			}
		}
	}

	const markdown = markdownParts.join("\n").trim();

	return {
		content: markdown,
		metadata: {
			title: metadata.title,
			author: metadata.author,
			siteName: metadata.siteName,
		},
		finalUrl: metadata.finalUrl || originalUrl,
		status: 200,
		contentType: "text/markdown",
		extractionMethod: metadata.extraction || "unknown",
		providerName: "clawfetch",
		fallbackSelector: metadata.fallbackSelector,
	};
}
