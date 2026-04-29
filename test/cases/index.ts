/**
 * Test Case Loader and Manager
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import { TestCase, TestCaseFile } from "./types.js";

const CASES_DIR = import.meta.dirname;

/**
 * Generate a slug from URL and issue
 */
export function generateSlug(url: string, issue: string): string {
	const urlSlug = new URL(url).hostname.replace("www.", "").replace(".", "-");
	const issueSlug = issue
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 30);
	const timestamp = Date.now().toString(36).slice(-4);
	return `${urlSlug}-${issueSlug}-${timestamp}`;
}

/**
 * Parse a test case file (YAML + markdown)
 */
export function parseCaseFile(content: string): TestCaseFile {
	const caseMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
	const yamlContent = caseMatch?.[1] || "";
	const restContent = content.slice(caseMatch?.[0].length || 0);

	// Parse YAML manually (simple key: value parser)
	const caseData: Record<string, unknown> = {};
	for (const line of yamlContent.split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex > 0) {
			const key = line.slice(0, colonIndex).trim();
			let value: string | string[] = line.slice(colonIndex + 1).trim();

			// Handle arrays
			if (value.startsWith("[") && value.endsWith("]")) {
				value = value
					.slice(1, -1)
					.split(",")
					.map((v) => v.trim().replace(/^["']|["']$/g, ""));
			} else {
				value = value.replace(/^["']|["']$/g, "");
			}

			if (key && value !== "") {
				caseData[key] = value;
			}
		}
	}

	// Parse sections
	const expectedMatch = restContent.match(/^```expected\n([\s\S]*?)\n```/m);
	const actualMatch = restContent.match(/^```actual\n([\s\S]*?)\n```/m);
	const assertionsMatch = restContent.match(/^```assertions\n([\s\S]*?)\n```/m);

	return {
		case: {
			id: caseData.id as string,
			url: caseData.url as string,
			reportedAt: caseData.reportedAt as string,
			issue: caseData.issue as string,
			provider: caseData.provider as TestCase["provider"],
			tags: (caseData.tags as string[]) || [],
			status: (caseData.status as TestCase["status"]) || "pending",
			expected: expectedMatch?.[1],
			actual: actualMatch?.[1] || (caseData.actual as string | undefined),
			customAssertions: assertionsMatch?.[1],
		},
		expected: expectedMatch?.[1],
		assertions: assertionsMatch?.[1],
	};
}

/**
 * Serialize a test case to file format
 */
export function serializeCaseFile(testCase: TestCase): string {
	const lines: string[] = ["---"];
	lines.push(`id: ${testCase.id}`);
	lines.push(`url: ${testCase.url}`);
	lines.push(`reportedAt: ${testCase.reportedAt}`);
	lines.push(`issue: ${testCase.issue}`);
	if (testCase.provider) {
		lines.push(`provider: ${testCase.provider}`);
	}
	lines.push(`tags: [${testCase.tags.join(", ")}]`);
	lines.push(`status: ${testCase.status}`);
	lines.push("---");

	if (testCase.expected) {
		lines.push("");
		lines.push("```expected");
		lines.push(testCase.expected);
		lines.push("```");
	}

	if (testCase.actual) {
		lines.push("");
		lines.push("```actual");
		lines.push(testCase.actual);
		lines.push("```");
	}

	if (testCase.customAssertions) {
		lines.push("");
		lines.push("```assertions");
		lines.push(testCase.customAssertions);
		lines.push("```");
	}

	return lines.join("\n");
}

/**
 * Load all test cases from the cases directory
 */
export function loadAllCases(): TestCaseFile[] {
	if (!existsSync(CASES_DIR)) {
		return [];
	}

	const files = readdirSync(CASES_DIR).filter(
		(f) => extname(f) === ".md" && !f.startsWith("_"),
	);

	const cases: TestCaseFile[] = [];
	for (const file of files) {
		try {
			const content = readFileSync(join(CASES_DIR, file), "utf-8");
			cases.push(parseCaseFile(content));
		} catch (error) {
			console.error(`Failed to load case from ${file}:`, error);
		}
	}

	return cases;
}

/**
 * Load a specific test case by ID
 */
export function loadCase(id: string): TestCaseFile | null {
	const filePath = join(CASES_DIR, `${id}.md`);
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		return parseCaseFile(content);
	} catch {
		return null;
	}
}

/**
 * Save a test case to file
 */
export function saveCase(testCase: TestCase): string {
	const filePath = join(CASES_DIR, `${testCase.id}.md`);
	writeFileSync(filePath, serializeCaseFile(testCase), "utf-8");
	return filePath;
}

/**
 * Get cases filtered by status
 */
export function getCasesByStatus(
	status: TestCase["status"],
): TestCaseFile[] {
	return loadAllCases().filter((c) => c.case.status === status);
}

/**
 * Get cases by tag
 */
export function getCasesByTag(tag: string): TestCaseFile[] {
	return loadAllCases().filter((c) => c.case.tags.includes(tag));
}

/**
 * List all case IDs
 */
export function listCaseIds(): string[] {
	if (!existsSync(CASES_DIR)) {
		return [];
	}
	return readdirSync(CASES_DIR)
		.filter((f) => extname(f) === ".md" && !f.startsWith("_"))
		.map((f) => basename(f, ".md"));
}
