/**
 * Fetch Method Registry
 *
 * Manages registration and selection of fetch method strategies.
 */

import type { FetchMethod, FetchMethodOptions } from "./strategy";
import type { FetchResult } from "../../extensions/types.js";

/**
 * Registry for fetch method strategies
 */
export class FetchMethodRegistry {
	private methods: Map<string, FetchMethod> = new Map();

	/**
	 * Register a fetch method
	 */
	register(method: FetchMethod): void {
		this.methods.set(method.name, method);
	}

	/**
	 * Unregister a fetch method
	 */
	unregister(name: string): boolean {
		return this.methods.delete(name);
	}

	/**
	 * Get a specific method by name
	 */
	get(name: string): FetchMethod | undefined {
		return this.methods.get(name);
	}

	/**
	 * Get all registered methods sorted by priority
	 */
	getAll(): FetchMethod[] {
		return Array.from(this.methods.values()).sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Select the best method for a URL
	 */
	selectForUrl(url: string): FetchMethod | null {
		const sorted = this.getAll();
		for (const method of sorted) {
			if (method.canHandle(url)) {
				return method;
			}
		}
		return null;
	}

	/**
	 * Execute with automatic method selection
	 */
	async execute(url: string, options?: FetchMethodOptions): Promise<FetchResult> {
		const method = this.selectForUrl(url);
		if (!method) {
			return {
				content: [{ type: "text", text: "No suitable fetch method found" }],
				details: {
					url,
					status: 0,
					processedAs: "error",
					contentType: null,
				},
			};
		}

		return method.fetch(url, options);
	}
}

/**
 * Default registry instance
 */
export const defaultFetchMethodRegistry = new FetchMethodRegistry();
