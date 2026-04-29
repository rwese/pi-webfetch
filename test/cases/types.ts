/**
 * Test Case Schema for URL regression testing
 */

export interface TestCase {
	/** Unique identifier (slug format: kebab-case) */
	id: string;
	/** The URL that had/beats an issue */
	url: string;
	/** When this case was reported */
	reportedAt: string;
	/** Brief description of the issue */
	issue: string;
	/** Provider to use: "default" | "clawfetch" | "gh-cli" (optional = auto) */
	provider?: "default" | "clawfetch" | "gh-cli";
	/** Expected markdown output (user fills after capture) */
	expected?: string;
	/** Actual observed output (captured by report-url) */
	actual?: string;
	/** Tags for filtering/organizing cases */
	tags: string[];
	/** Optional custom test assertions (YAML block) */
	customAssertions?: string;
	/** Whether this test is currently passing */
	status: "pending" | "passing" | "failing";
}

export interface TestCaseFile {
	/** Metadata section */
	case: TestCase;
	/** Expected output section */
	expected?: string;
	/** Custom assertions (if any) */
	assertions?: string;
}

export interface RegressionResult {
	caseId: string;
	status: "pass" | "fail" | "pending";
	url: string;
	issue: string;
	expectedMatch: boolean;
	duration: number;
	error?: string;
}
