#!/usr/bin/env node

/**
 * report-url.ts - CLI tool to report and capture URL test cases
 *
 * Usage:
 *   npx tsx test/report-url.ts <url> --issue "description"
 *   npx tsx test/report-url.ts <url> --issue "broken tables" --provider clawfetch
 *   npx tsx test/report-url.ts --list
 *   npx tsx test/report-url.ts --status pending
 */

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadCase, saveCase, generateSlug, listCaseIds, getCasesByStatus } from "./cases/index.js";
import type { TestCase } from "./cases/types.js";

interface CliArgs {
	url?: string;
	issue?: string;
	provider?: "default" | "clawfetch" | "gh-cli";
	actual?: string;
	status?: "pending" | "passing" | "failing";
	list?: boolean;
	statusFilter?: "pending" | "passing" | "failing";
	update?: string;
	tags?: string[];
	help?: boolean;
}

function parseCliArgs(): CliArgs {
	const { values } = parseArgs({
		options: {
			url: { type: "string", short: "u" },
			issue: { type: "string", short: "i" },
			provider: { type: "string", short: "p" },
			actual: { type: "string", short: "a" },
			status: { type: "string" },
			list: { type: "boolean", short: "l" },
			status_filter: { type: "string", short: "s" },
			update: { type: "string", short: "U" },
			tags: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	return {
		url: values.url,
		issue: values.issue,
		provider: values.provider as CliArgs["provider"],
		actual: values.actual,
		status: values.status as CliArgs["status"],
		list: values.list,
		statusFilter: values.status_filter as CliArgs["statusFilter"],
		update: values.update,
		tags: values.tags ? values.tags.split(",").map((t) => t.trim()) : undefined,
		help: values.help,
	};
}

function printHelp() {
	console.log(`
report-url - Report and manage URL test cases for regression testing

USAGE
  report-url <url> [OPTIONS]
  report-url --list [OPTIONS]
  report-url --update <case-id> [OPTIONS]

OPTIONS
  -u, --url <url>              URL to report
  -i, --issue <description>    Brief description of the issue
  -p, --provider <provider>    Provider to use: default, clawfetch, gh-cli
  -a, --actual <text>          Actual observed output (for manual capture)
  -U, --update <case-id>       Update an existing case
  --status <status>           Set status: pending, passing, failing
  -t, --tags <tags>            Comma-separated tags

LIST OPTIONS
  -l, --list                   List all cases
  -s, --status_filter <status> Filter by status: pending, passing, failing

EXAMPLES
  # Report a new issue
  report-url https://github.com/user/repo/issues/123 --issue "broken code blocks"

  # List all pending cases
  report-url --list --status_filter pending

  # Update a case with actual output
  report-url --update github-issue-42 --actual "$(cat output.md)"

  # Mark a case as passing
  report-url --update github-issue-42 --status passing
`);
}

async function reportUrl(args: CliArgs): Promise<void> {
	if (!args.url || !args.issue) {
		console.error("Error: --url and --issue are required for reporting");
		process.exit(1);
	}

	const id = generateSlug(args.url, args.issue);
	const existing = loadCase(id);

	if (existing) {
		console.log(`Case already exists: ${id}`);
		console.log(`  URL: ${existing.case.url}`);
		console.log(`  Issue: ${existing.case.issue}`);
		console.log(`  Status: ${existing.case.status}`);
		console.log("\nUse --update to modify this case.");
		return;
	}

	const testCase: TestCase = {
		id,
		url: args.url,
		reportedAt: new Date().toISOString(),
		issue: args.issue,
		provider: args.provider,
		tags: args.tags || [],
		status: "pending",
		actual: args.actual,
	};

	const filePath = saveCase(testCase);
	console.log(`✅ Created test case: ${id}`);
	console.log(`   File: ${filePath}`);
	console.log(`   URL: ${testCase.url}`);
	console.log(`   Issue: ${testCase.issue}`);
	console.log("\nNext steps:");
	console.log("  1. Fetch the URL and capture actual output");
	console.log("  2. Edit the file to add expected output");
	console.log("  3. Write assertions if needed");
	console.log("  4. Run: npm run test:regression");
}

async function updateCase(args: CliArgs): Promise<void> {
	if (!args.update) {
		console.error("Error: --update requires a case ID");
		process.exit(1);
	}

	const existing = loadCase(args.update);
	if (!existing) {
		console.error(`Error: Case not found: ${args.update}`);
		console.log("\nUse --list to see available cases.");
		process.exit(1);
	}

	const updated: TestCase = {
		...existing.case,
		actual: args.actual ?? existing.case.actual,
		status: (args.status as TestCase["status"]) ?? existing.case.status,
		tags: args.tags ?? existing.case.tags,
	};

	saveCase(updated);
	console.log(`✅ Updated case: ${args.update}`);
	console.log(`   Status: ${updated.status}`);
	if (updated.actual) {
		console.log(`   Has actual output: ${updated.actual.length} chars`);
	}
}

async function listCases(args: CliArgs): Promise<void> {
	let cases: ReturnType<typeof getCasesByStatus>;

	if (args.statusFilter) {
		cases = getCasesByStatus(args.statusFilter);
	} else {
		cases = getCasesByStatus("pending");
	}

	const ids = listCaseIds();

	if (ids.length === 0) {
		console.log("No test cases found.");
		console.log("\nCreate one with:");
		console.log("  report-url <url> --issue 'description'");
		return;
	}

	console.log(`\nTest Cases (${ids.length} total):\n`);

	const allCases = ids.map((id) => loadCase(id)).filter(Boolean);
	const byStatus = {
		pending: allCases.filter((c) => c?.case.status === "pending"),
		failing: allCases.filter((c) => c?.case.status === "failing"),
		passing: allCases.filter((c) => c?.case.status === "passing"),
	};

	console.log(`  Status: ${byStatus.pending.length} pending, ${byStatus.failing.length} failing, ${byStatus.passing.length} passing\n`);

	if (args.statusFilter) {
		const filtered = byStatus[args.statusFilter as keyof typeof byStatus] || [];
		for (const c of filtered) {
			if (!c) continue;
			console.log(`  [${c.case.status.toUpperCase()}] ${c.case.id}`);
			console.log(`    URL: ${c.case.url}`);
			console.log(`    Issue: ${c.case.issue}`);
			if (c.case.tags.length > 0) {
				console.log(`    Tags: ${c.case.tags.join(", ")}`);
			}
			console.log();
		}
	} else {
		for (const c of allCases) {
			if (!c) continue;
			const statusIcon =
				c.case.status === "passing"
					? "✅"
					: c.case.status === "failing"
						? "❌"
						: "⏳";
			console.log(`  ${statusIcon} [${c.case.status.toUpperCase()}] ${c.case.id}`);
			console.log(`    URL: ${c.case.url}`);
			console.log(`    Issue: ${c.case.issue}`);
			if (c.case.tags.length > 0) {
				console.log(`    Tags: ${c.case.tags.join(", ")}`);
			}
			console.log();
		}
	}
}

async function main() {
	const args = parseCliArgs();

	if (args.help) {
		printHelp();
		return;
	}

	if (args.list || (!args.url && !args.update)) {
		await listCases(args);
	} else if (args.update) {
		await updateCase(args);
	} else {
		await reportUrl(args);
	}
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
