/**
 * Fetch Method Strategy
 *
 * Strategy pattern for different fetch approaches.
 * Allows adding new fetch methods without modifying existing code (OCP).
 */

import type { FetchResult } from "../../extensions/types.js";

/**
 * Strategy interface for fetch methods
 */
export interface FetchMethod {
	/** Unique name for this fetch method */
	readonly name: string;

	/** Priority (higher = tried first) */
	readonly priority: number;

	/** Check if this method can handle the URL */
	canHandle(url: string): boolean;

	/** Execute the fetch */
	fetch(url: string, options?: FetchMethodOptions): Promise<FetchResult>;
}

/**
 * Options for fetch method execution
 */
export interface FetchMethodOptions {
	/** Custom timeout in ms */
	timeout?: number;
	/** User agent override */
	userAgent?: string;
	/** Proxy settings */
	proxy?: string;
	/** Request headers */
	headers?: Record<string, string>;
}

/**
 * Result from a fetch method
 */
export interface FetchMethodResult {
	/** Whether the fetch was successful */
	success: boolean;
	/** The fetch result if successful */
	result?: FetchResult;
	/** Error message if failed */
	error?: string;
}
