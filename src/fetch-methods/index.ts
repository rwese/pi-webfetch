/**
 * Fetch Methods
 *
 * Strategy pattern implementations for different fetch approaches.
 */

export type {
	FetchMethod,
	FetchMethodOptions,
	FetchMethodResult,
} from "./strategy.js";

export { StaticFetchMethod } from "./static-fetch-method.js";
export { FetchMethodRegistry, defaultFetchMethodRegistry } from "./registry.js";
