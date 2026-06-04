/**
 * Gh CLI Provider - GitHub Fetch Options
 *
 * Verifies that `GitHubFetchOptions` (currently `includeComments`) is threaded
 * from `fetchByType` down to the `gh` CLI argv, and that the discovery hint
 * is appended to content / surfaced via `metadata.githubHint`.
 *
 * These tests mock `execAsync` so they do not require an authenticated `gh`
 * CLI on the host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the process module that content-fetcher.ts uses to talk to `gh`.
// The mock lets each test record the argv it was called with and return
// a fixture-shaped JSON response.
const execAsyncMock = vi.fn();
const execAsyncFullMock = vi.fn();
const killProcessTreeMock = vi.fn();

vi.mock('../src/utils/process.js', () => ({
	execAsync: (...args: unknown[]) => execAsyncMock(...args),
	execAsyncFull: (...args: unknown[]) => execAsyncFullMock(...args),
	killProcessTree: (...args: unknown[]) => killProcessTreeMock(...args),
	ProcessMutex: class {
		async acquire() {}
		release() {}
		isLocked() {
			return false;
		}
		async withLock<T>(fn: () => Promise<T>): Promise<T> {
			return await fn();
		}
	},
	ExecAsyncError: class extends Error {},
}));

import {
	appendGitHubHint,
	buildGitHubHint,
	fetchByType,
	fetchIssue,
	fetchPr,
} from '../src/providers/gh/content-fetcher.js';
import type { ParsedGitHubUrl } from '../src/providers/gh/url-parser.js';

const issueParsed: ParsedGitHubUrl = {
	owner: 'facebook',
	repo: 'react',
	type: 'issue',
	number: 1,
};
const prParsed: ParsedGitHubUrl = {
	owner: 'facebook',
	repo: 'react',
	type: 'pr',
	number: 1,
};
const repoParsed: ParsedGitHubUrl = {
	owner: 'facebook',
	repo: 'react',
	type: 'repo',
};

const ghPath = '/usr/local/bin/gh';

function setGhResponse(json: unknown) {
	execAsyncMock.mockResolvedValueOnce(JSON.stringify(json));
}

function getLastCallArgs(): string[] {
	const call = execAsyncMock.mock.calls.at(-1);
	if (!call) {
		throw new Error('execAsync was not called');
	}
	const args = call[1] as string[];
	return args;
}

beforeEach(() => {
	execAsyncMock.mockReset();
	killProcessTreeMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('buildGitHubHint', () => {
	it('returns the discovery hint for issues when includeComments is not set', () => {
		const hint = buildGitHubHint(issueParsed);
		expect(hint).toContain('Tip');
		expect(hint).toContain('includeComments');
		expect(hint).toContain('--include-comments');
	});

	it('returns the discovery hint for PRs when includeComments is not set', () => {
		const hint = buildGitHubHint(prParsed);
		expect(hint).toContain('Tip');
		expect(hint).toContain('includeComments');
		expect(hint).toContain('--include-comments');
	});

	it('returns an empty string when includeComments is true', () => {
		expect(buildGitHubHint(issueParsed, { includeComments: true })).toBe('');
		expect(buildGitHubHint(prParsed, { includeComments: true })).toBe('');
	});

	it('returns an empty string for non-hinted URL types', () => {
		expect(buildGitHubHint(repoParsed)).toBe('');
		expect(buildGitHubHint({ ...repoParsed, type: 'tree' })).toBe('');
		expect(buildGitHubHint({ ...repoParsed, type: 'blob' })).toBe('');
		expect(buildGitHubHint({ ...repoParsed, type: 'unknown' })).toBe('');
	});
});

describe('appendGitHubHint', () => {
	it('appends the hint tail to content and returns the matching hint string', () => {
		const result = appendGitHubHint('# Title\n\nbody', issueParsed);
		expect(result.hint).toContain('Tip');
		expect(result.content).toContain('# Title');
		expect(result.content.endsWith(result.hint)).toBe(true);
	});

	it('returns the original content unchanged when no hint applies', () => {
		const original = 'plain content';
		const result = appendGitHubHint(original, repoParsed);
		expect(result.content).toBe(original);
		expect(result.hint).toBe('');
	});
});

describe('fetchByType argv construction with GitHubFetchOptions', () => {
	const baseIssueJson = {
		title: 'Sample issue',
		body: 'issue body',
		state: 'OPEN',
		author: { login: 'octocat' },
		labels: [],
		assignees: [],
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		comments: [
			{ author: { login: 'reviewer' }, body: 'hi', createdAt: '2025-01-02T00:00:00Z' },
		],
	};
	const basePrJson = {
		title: 'Sample PR',
		body: 'pr body',
		state: 'OPEN',
		author: { login: 'octocat' },
		additions: 5,
		deletions: 1,
		changedFiles: 2,
		commits: 1,
		reviews: [
			{
				author: { login: 'reviewer' },
				state: 'APPROVED',
				submittedAt: '2025-01-02T00:00:00Z',
				body: 'LGTM',
			},
		],
		comments: [
			{ author: { login: 'commenter' }, body: 'thanks', createdAt: '2025-01-03T00:00:00Z' },
		],
	};

	it('omits --comments for issues by default', async () => {
		setGhResponse(baseIssueJson);
		await fetchByType(ghPath, issueParsed, 1000);
		const args = getLastCallArgs();
		expect(args).toEqual([
			'issue',
			'view',
			'1',
			'--repo',
			'facebook/react',
			'--json',
			'title,body,state,author,labels,assignees,createdAt,updatedAt,comments',
		]);
	});

	it('adds --comments to the gh argv for issues when includeComments is true', async () => {
		setGhResponse(baseIssueJson);
		await fetchByType(ghPath, issueParsed, 1000, { includeComments: true });
		const args = getLastCallArgs();
		expect(args).toContain('--comments');
		expect(args[0]).toBe('issue');
	});

	it('omits --comments for PRs by default', async () => {
		setGhResponse(basePrJson);
		await fetchByType(ghPath, prParsed, 1000);
		const args = getLastCallArgs();
		expect(args).not.toContain('--comments');
		expect(args[0]).toBe('pr');
	});

	it('adds --comments to the gh argv for PRs when includeComments is true', async () => {
		setGhResponse(basePrJson);
		await fetchByType(ghPath, prParsed, 1000, { includeComments: true });
		const args = getLastCallArgs();
		expect(args).toContain('--comments');
		// The PR JSON should now also include the `comments` field.
		const jsonArg = args[args.indexOf('--json') + 1];
		expect(jsonArg).toContain('comments');
	});
});

describe('fetchByType hint behaviour', () => {
	const baseIssueJson = {
		title: 'Sample issue',
		body: 'body',
		state: 'OPEN',
		author: { login: 'octocat' },
		labels: [],
		assignees: [],
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		comments: [],
	};
	const basePrJson = {
		title: 'Sample PR',
		body: 'body',
		state: 'OPEN',
		author: { login: 'octocat' },
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		commits: 0,
		reviews: [],
		comments: [],
	};

	it('appends the discovery hint to issue content when includeComments is not set', async () => {
		setGhResponse(baseIssueJson);
		const result = await fetchByType(ghPath, issueParsed, 1000);
		expect(result.content).toContain('Tip:');
		expect(result.metadata.githubHint).toContain('Tip:');
		// Default for issues no longer includes comments
		expect(result.content).not.toContain('## Comments');
	});

	it('does NOT include comments when includeComments is false', async () => {
		setGhResponse(baseIssueJson);
		const result = await fetchByType(ghPath, issueParsed, 1000, { includeComments: false });
		// Comments section only appears when includeComments is true; with false,
		// the section should not exist in the body.
		expect(result.content).not.toContain('## Comments\n');
		// Hint should still be present because includeComments is not "true".
		expect(result.content).toContain('Tip:');
		expect(result.metadata.githubHint).toContain('Tip:');
	});

	it('appends the hint but does not include the Comments section when option is undefined', async () => {
		setGhResponse(baseIssueJson);
		const result = await fetchByType(ghPath, issueParsed, 1000, undefined);
		expect(result.content).toContain('Tip:');
		expect(result.metadata.githubHint).toContain('Tip:');
	});

	it('omits the hint and includes comments when includeComments is true (issue)', async () => {
		setGhResponse({
			...baseIssueJson,
			comments: [{ author: { login: 'reviewer' }, body: 'hi', createdAt: '2025-01-02T00:00:00Z' }],
		});
		const result = await fetchByType(ghPath, issueParsed, 1000, { includeComments: true });
		expect(result.content).toContain('## Comments');
		expect(result.content).toContain('### @reviewer');
		expect(result.content).not.toContain('Tip:');
		expect(result.metadata.githubHint).toBeUndefined();
	});

	it('omits the hint and includes review threads + comments when includeComments is true (PR)', async () => {
		setGhResponse({
			...basePrJson,
			reviews: [
				{
					author: { login: 'reviewer' },
					state: 'APPROVED',
					submittedAt: '2025-01-02T00:00:00Z',
					body: 'LGTM',
				},
			],
			comments: [
				{ author: { login: 'commenter' }, body: 'thanks', createdAt: '2025-01-03T00:00:00Z' },
			],
		});
		const result = await fetchByType(ghPath, prParsed, 1000, { includeComments: true });
		expect(result.content).toContain('## Review Threads');
		expect(result.content).toContain('Review by @reviewer');
		expect(result.content).toContain('LGTM');
		expect(result.content).toContain('## Comments');
		expect(result.content).toContain('### @commenter');
		expect(result.content).not.toContain('Tip:');
		expect(result.metadata.githubHint).toBeUndefined();
	});

	it('omits review threads and Comments for PRs when includeComments is not set', async () => {
		setGhResponse(basePrJson);
		const result = await fetchByType(ghPath, prParsed, 1000);
		expect(result.content).not.toContain('## Review Threads');
		expect(result.content).not.toContain('## Comments');
		expect(result.content).toContain('Tip:');
		expect(result.metadata.githubHint).toContain('Tip:');
	});
});

describe('fetchIssue / fetchPr direct entrypoints', () => {
	const baseIssueJson = {
		title: 'Sample issue',
		body: 'body',
		state: 'OPEN',
		author: { login: 'octocat' },
		labels: [],
		assignees: [],
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		comments: [],
	};

	it('fetchIssue accepts the GitHubFetchOptions option parameter', async () => {
		setGhResponse(baseIssueJson);
		const result = await fetchIssue(ghPath, 'facebook/react', 1, 1000);
		expect(result.content).toContain('Sample issue');
		expect(result.metadata.githubHint).toContain('Tip:');
	});

	it('fetchIssue with includeComments=true omits the hint and adds the Comments section', async () => {
		setGhResponse({
			...baseIssueJson,
			comments: [
				{ author: { login: 'reviewer' }, body: 'hi', createdAt: '2025-01-02T00:00:00Z' },
			],
		});
		const result = await fetchIssue(ghPath, 'facebook/react', 1, 1000, { includeComments: true });
		expect(result.content).toContain('## Comments');
		expect(result.content).not.toContain('Tip:');
		expect(result.metadata.githubHint).toBeUndefined();
	});

	it('fetchPr with includeComments=false emits the hint and omits reviews/comments', async () => {
		setGhResponse({
			title: 'Sample PR',
			body: 'body',
			state: 'OPEN',
			author: { login: 'octocat' },
			additions: 0,
			deletions: 0,
			changedFiles: 0,
			commits: 0,
			reviews: [],
			comments: [],
		});
		const result = await fetchPr(ghPath, 'facebook/react', 1, 1000, { includeComments: false });
		expect(result.content).not.toContain('## Review Threads');
		expect(result.content).not.toContain('## Comments');
		expect(result.content).toContain('Tip:');
		expect(result.metadata.githubHint).toContain('Tip:');
	});
});
