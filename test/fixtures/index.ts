/**
 * Fixture Loader - Load HTTP response fixtures for regression testing
 *
 * Structure:
 *   <name>/
 *   ├── response.json  - Status, headers, body file ref
 *   └── body.raw       - Raw response body
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = __dirname;

export interface FixtureResponse {
	url: string;
	method: string;
	fetchedAt: string;
	provider: string;
	status: number;
	contentType: string;
	contentEncoding: "html" | "json" | "text" | "binary";
	headers: Record<string, string>;
	bodyFile: string;
}

export interface Fixture {
	name: string;
	url: string;
	fetchedAt: string;
	provider: string;
	status: number;
	contentType: string;
	contentEncoding: "html" | "json" | "text" | "binary";
	headers: Record<string, string>;
	body: string;
	files: {
		dir: string;
		response: string;
		raw: string;
	};
}

/**
 * Load fixture by name (directory name)
 */
export function loadFixture(name: string): Fixture | null {
	const fixtureDir = join(FIXTURES_DIR, name);
	const responsePath = join(fixtureDir, "response.json");

	if (!existsSync(responsePath)) {
		return null;
	}

	try {
		const response: FixtureResponse = JSON.parse(
			readFileSync(responsePath, "utf-8"),
		);

		// Load body from raw file
		const rawPath = join(fixtureDir, response.bodyFile);
		let body = "";

		if (existsSync(rawPath)) {
			const encoding = response.contentEncoding === "binary" ? "latin-1" : "utf-8";
			body = readFileSync(rawPath, encoding as BufferEncoding);
		}

		return {
			name,
			url: response.url,
			fetchedAt: response.fetchedAt,
			provider: response.provider,
			status: response.status,
			contentType: response.contentType,
			contentEncoding: response.contentEncoding,
			headers: response.headers,
			body,
			files: {
				dir: fixtureDir,
				response: responsePath,
				raw: rawPath,
			},
		};
	} catch (error) {
		console.error(`Failed to load fixture ${name}:`, error);
		return null;
	}
}

/**
 * List all fixture names (directory names)
 */
export function listFixtures(): string[] {
	if (!existsSync(FIXTURES_DIR)) {
		return [];
	}

	return readdirSync(FIXTURES_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith("_"))
		.map((d) => d.name);
}

/**
 * Get fixture info without loading body
 */
export function getFixtureInfo(name: string): {
	exists: boolean;
	info?: Omit<Fixture, "body" | "files">;
} {
	const responsePath = join(FIXTURES_DIR, name, "response.json");

	if (!existsSync(responsePath)) {
		return { exists: false };
	}

	try {
		const response: FixtureResponse = JSON.parse(
			readFileSync(responsePath, "utf-8"),
		);

		return {
			exists: true,
			info: {
				name,
				url: response.url,
				fetchedAt: response.fetchedAt,
				provider: response.provider,
				status: response.status,
				contentType: response.contentType,
				contentEncoding: response.contentEncoding,
				headers: response.headers,
			},
		};
	} catch {
		return { exists: false };
	}
}

/**
 * Process fixture through markdown conversion
 */
export async function processFixture(
	name: string,
	convertFn: (html: string, options?: { contentType?: string }) => Promise<string>,
): Promise<{
	fixture: Fixture;
	markdown?: string;
	error?: string;
	stats: {
		originalSize: number;
		markdownSize: number;
		hasImages: boolean;
		hasCodeBlocks: boolean;
		hasTables: boolean;
		lineCount: number;
	};
}> {
	const fixture = loadFixture(name);

	if (!fixture) {
		throw new Error(`Fixture not found: ${name}`);
	}

	try {
		const markdown = await convertFn(fixture.body, {
			contentType: fixture.contentType,
		});

		return {
			fixture,
			markdown,
			stats: {
				originalSize: fixture.body.length,
				markdownSize: markdown.length,
				hasImages: /\!\[.*?\]\(.*?\)/.test(markdown),
				hasCodeBlocks: /```[\s\S]*?```/.test(markdown),
				hasTables: /^\|.*\|/m.test(markdown),
				lineCount: markdown.split("\n").length,
			},
		};
	} catch (error) {
		return {
			fixture,
			error: error instanceof Error ? error.message : String(error),
			stats: {
				originalSize: fixture.body.length,
				markdownSize: 0,
				hasImages: false,
				hasCodeBlocks: false,
				hasTables: false,
				lineCount: 0,
			},
		};
	}
}
