/**
 * Static Fetch Method
 *
 * Strategy implementation for static HTTP fetch without browser rendering.
 */

import type { FetchMethod, FetchMethodOptions } from "./strategy";
import type { FetchResult } from "../../extensions/types.js";

/**
 * Static fetch method - uses native fetch without JavaScript rendering
 */
export class StaticFetchMethod implements FetchMethod {
	readonly name = "static";
	readonly priority = 0; // Lowest priority - fallback only

	canHandle(_url: string): boolean {
		// Static fetch can handle any URL
		// But it's typically used as a fallback
		return true;
	}

	async fetch(url: string, options?: FetchMethodOptions): Promise<FetchResult> {
		const controller = new AbortController();
		const timeout = options?.timeout || 30000;

		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: options?.headers,
			});

			clearTimeout(timeoutId);

			// Return result directly
			const result: FetchResult = {
				content: [{ type: "text", text: `Static fetch returned status: ${response.status}` }],
				details: {
					url,
					status: response.status,
					contentType: response.headers.get("content-type"),
					processedAs: "fallback",
				},
			};

			return result;
		} catch (error) {
			clearTimeout(timeoutId);
			return {
				content: [
					{
						type: "text",
						text: `Static fetch failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				details: {
					url,
					status: 0,
					processedAs: "error",
					contentType: null,
				},
			};
		}
	}
}
