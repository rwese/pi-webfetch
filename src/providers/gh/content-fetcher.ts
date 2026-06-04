/**
 * GitHub Content Fetcher
 *
 * Fetches GitHub content (issues, PRs, repos, files) using the gh CLI.
 */

import { execAsync } from '../../utils/process.js';
import type { GitHubFetchOptions, ProviderFetchResult } from '../types.js';
import { ProviderError } from '../types.js';
import type { ParsedGitHubUrl } from './url-parser.js';
import {
	isImageFile,
	isMarkdownFile,
	isCodeFile,
	isTextFile,
	getCodeLanguage,
	getFileIcon,
	formatFileSize,
} from './file-type-detector.js';

/**
 * URL types where the caller can opt in to richer content (comments, review threads).
 * The hint is only emitted for these; other GitHub URL types (repo/tree/blob) are
 * already self-contained.
 */
const HINTED_GITHUB_URL_TYPES = new Set<ParsedGitHubUrl['type']>(['issue', 'pr']);

/**
 * Build a markdown tip + matching machine-readable hint string that points callers
 * at the GitHub fetch options they did not enable. The hint message is generic
 * (no CLI-only syntax) so the same string can be surfaced through CLI, MCP, and
 * the pi extension.
 */
export function buildGitHubHint(parsed: ParsedGitHubUrl, options?: GitHubFetchOptions): string {
	const includeComments = options?.includeComments === true;
	if (includeComments) {
		// Caller already opted in; no need to advertise.
		return '';
	}
	if (!HINTED_GITHUB_URL_TYPES.has(parsed.type)) {
		return '';
	}
	return '> Tip: pass `includeComments: true` (CLI: `--include-comments`) to include issue comments and PR review threads.';
}

/**
 * Append a discovery hint tail to fetched content. Returns the new content and
 * the matching `githubHint` string (empty if no hint applies).
 */
export function appendGitHubHint(
	content: string,
	parsed: ParsedGitHubUrl,
	options?: GitHubFetchOptions,
): { content: string; hint: string } {
	const hint = buildGitHubHint(parsed, options);
	if (!hint) {
		return { content, hint: '' };
	}
	return { content: `${content}\n\n${hint}`, hint };
}

/**
 * Execute gh CLI command
 */
export async function execGh(gh: string, args: string[], timeout: number): Promise<string> {
	try {
		return await execAsync(gh, args, { timeout });
	} catch (error) {
		if (error instanceof ProviderError) {
			throw error;
		}
		throw new ProviderError(error instanceof Error ? error.message : String(error), 'gh-cli');
	}
}

/**
 * Fetch an issue using gh issue view
 */
export async function fetchIssue(
	gh: string,
	repo: string,
	number: number,
	timeout: number,
	options?: GitHubFetchOptions,
): Promise<ProviderFetchResult> {
	const includeComments = options?.includeComments === true;
	const args = [
		'issue',
		'view',
		number.toString(),
		'--repo',
		repo,
		'--json',
		'title,body,state,author,labels,assignees,createdAt,updatedAt,comments',
	];
	if (includeComments) {
		args.push('--comments');
	}

	const output = await execGh(gh, args, timeout);
	const data = JSON.parse(output);

	const comments = data.comments || [];
	let content = `# ${data.title || `Issue #${number}`}\n\n`;

	// Add metadata
	content += `**State:** ${data.state || 'unknown'}\n`;
	content += `**Author:** ${data.author?.login || 'unknown'}\n`;
	content += `**Created:** ${data.createdAt ? new Date(data.createdAt).toISOString().split('T')[0] : 'unknown'}\n`;

	if (data.labels && data.labels.length > 0) {
		content += `**Labels:** ${data.labels.map((l: { name: string }) => l.name).join(', ')}\n`;
	}

	if (data.assignees && data.assignees.length > 0) {
		content += `**Assignees:** ${data.assignees.map((a: { login: string }) => a.login).join(', ')}\n`;
	}

	content += `\n---\n\n`;

	// Add body
	if (data.body) {
		content += `${data.body}\n\n`;
	}

	// Add comments
	if (includeComments && comments.length > 0) {
		content += `---\n\n## Comments\n\n`;
		for (const comment of comments) {
			const date = comment.createdAt
				? new Date(comment.createdAt).toISOString().split('T')[0]
				: '';
			content += `### @${comment.author?.login || 'unknown'} (${date})\n\n`;
			content += `${comment.body}\n\n---\n\n`;
		}
	}

	const parsed: ParsedGitHubUrl = {
		owner: repo.split('/')[0] || '',
		repo: repo.split('/')[1] || '',
		type: 'issue',
		number,
	};
	const withHint = appendGitHubHint(content.trim(), parsed, options);

	return {
		content: withHint.content,
		metadata: {
			title: data.title,
			author: data.author?.login,
			githubHint: withHint.hint || undefined,
		},
		finalUrl: `https://github.com/${repo}/issues/${number}`,
		status: 200,
		contentType: 'text/markdown',
		extractionMethod: 'gh-issue-view',
		providerName: 'gh-cli',
	};
}

/**
 * Fetch a PR using gh pr view
 */
export async function fetchPr(
	gh: string,
	repo: string,
	number: number,
	timeout: number,
	options?: GitHubFetchOptions,
): Promise<ProviderFetchResult> {
	const includeComments = options?.includeComments === true;
	// When the caller opts in to PR conversation comments, we add `--comments`
	// and pull the `comments` field. Review bodies always come back via
	// `reviews[].body` (no extra flag required).
	const jsonFields = includeComments
		? 'title,body,state,author,additions,deletions,changedFiles,commits,reviews,comments'
		: 'title,body,state,author,additions,deletions,changedFiles,commits,reviews';
	const args = [
		'pr',
		'view',
		number.toString(),
		'--repo',
		repo,
		'--json',
		jsonFields,
	];
	if (includeComments) {
		args.push('--comments');
	}

	const output = await execGh(gh, args, timeout);
	const data = JSON.parse(output);

	let content = `# ${data.title || `PR #${number}`}\n\n`;

	// Add metadata
	content += `**State:** ${data.state || 'unknown'}\n`;
	content += `**Author:** ${data.author?.login || 'unknown'}\n`;
	content += `**Files changed:** ${data.changedFiles || 0}\n`;
	content += `**Additions:** +${data.additions || 0}\n`;
	content += `**Deletions:** -${data.deletions || 0}\n`;
	content += `**Commits:** ${data.commits || 0}\n`;

	content += `\n---\n\n`;

	// Add body
	if (data.body) {
		content += `${data.body}\n\n`;
	}

	// Review bodies (each review = one section; threaded discussion is collapsed
	// into a single review entry by the gh CLI JSON output).
	if (includeComments && Array.isArray(data.reviews) && data.reviews.length > 0) {
		content += `---\n\n## Review Threads\n\n`;
		for (const review of data.reviews) {
			const author = review.author?.login || 'unknown';
			const state = review.state || 'COMMENTED';
			const submittedAt = review.submittedAt
				? new Date(review.submittedAt).toISOString().split('T')[0]
				: '';
			const submitted = submittedAt ? ` (${submittedAt})` : '';
			content += `### Review by @${author} — ${state}${submitted}\n\n`;
			if (review.body) {
				content += `${review.body}\n\n`;
			}
			content += `---\n\n`;
		}
	}

	// PR conversation comments (distinct from review bodies).
	if (includeComments && Array.isArray(data.comments) && data.comments.length > 0) {
		content += `## Comments\n\n`;
		for (const comment of data.comments) {
			const author = comment.author?.login || 'unknown';
			const createdAt = comment.createdAt
				? new Date(comment.createdAt).toISOString().split('T')[0]
				: '';
			const created = createdAt ? ` (${createdAt})` : '';
			content += `### @${author}${created}\n\n`;
			if (comment.body) {
				content += `${comment.body}\n\n`;
			}
			content += `---\n\n`;
		}
	}

	const parsed: ParsedGitHubUrl = {
		owner: repo.split('/')[0] || '',
		repo: repo.split('/')[1] || '',
		type: 'pr',
		number,
	};
	const withHint = appendGitHubHint(content.trim(), parsed, options);

	return {
		content: withHint.content,
		metadata: {
			title: data.title,
			author: data.author?.login,
			githubHint: withHint.hint || undefined,
		},
		finalUrl: `https://github.com/${repo}/pull/${number}`,
		status: 200,
		contentType: 'text/markdown',
		extractionMethod: 'gh-pr-view',
		providerName: 'gh-cli',
	};
}

/**
 * Fetch a repo using gh repo view
 */
export async function fetchRepo(
	gh: string,
	repo: string,
	timeout: number,
): Promise<ProviderFetchResult> {
	const args = [
		'repo',
		'view',
		repo,
		'--json',
		'name,description,owner,defaultBranchRef,stargazerCount,forkCount,openIssueCount,openPRCount,licenseInfo,languages',
	];

	const output = await execGh(gh, args, timeout);
	const data = JSON.parse(output);

	let content = `# ${data.name || repo}\n\n`;

	// Add metadata
	if (data.description) {
		content += `${data.description}\n\n`;
	}

	content += `**Owner:** ${data.owner?.login || 'unknown'}\n`;
	content += `**Default branch:** ${data.defaultBranchRef?.name || 'main'}\n`;
	content += `**Stars:** ${data.stargazerCount || 0}\n`;
	content += `**Forks:** ${data.forkCount || 0}\n`;
	content += `**Open Issues:** ${data.openIssueCount || 0}\n`;
	content += `**Open PRs:** ${data.openPRCount || 0}\n`;

	if (data.licenseInfo?.name) {
		content += `**License:** ${data.licenseInfo.name}\n`;
	}

	if (data.languages && Object.keys(data.languages).length > 0) {
		const langs = Object.entries(data.languages as Record<string, number>)
			.sort((a, b) => b[1] - a[1])
			.map(([lang, bytes]) => `${lang} (${(bytes / 1000).toFixed(1)}k)`)
			.join(', ');
		content += `**Languages:** ${langs}\n`;
	}

	return {
		content: content.trim(),
		metadata: {
			title: data.name,
			author: data.owner?.login,
			excerpt: data.description,
		},
		finalUrl: `https://github.com/${repo}`,
		status: 200,
		contentType: 'text/markdown',
		extractionMethod: 'gh-repo-view',
		providerName: 'gh-cli',
	};
}

/**
 * Entry in directory listing
 */
interface DirectoryEntry {
	name: string;
	type: string;
	size: number;
	download_url: string | null;
	html_url: string;
}

/**
 * Fetch directory contents using GitHub API
 */
export async function fetchDirectory(
	gh: string,
	repo: string,
	ref: string,
	path: string,
	timeout: number,
): Promise<ProviderFetchResult> {
	const apiPath = path ? `/repos/${repo}/contents/${path}` : `/repos/${repo}/contents`;
	// Add ref as query parameter
	const fullPath = `${apiPath}?ref=${ref}`;
	const args = ['api', fullPath, '--jq', '.'];

	const output = await execGh(gh, args, timeout);

	// The API returns an array of entries
	let entries: DirectoryEntry[];

	try {
		entries = JSON.parse(output);
	} catch {
		// Single file returned - this is actually a file, not a directory
		// Re-fetch as a file
		return fetchFile(gh, repo, ref, path, timeout);
	}

	if (!Array.isArray(entries)) {
		return fetchFile(gh, repo, ref, path, timeout);
	}

	// Sort: directories first, then files, alphabetically
	entries.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === 'dir' ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	const displayPath = path || '/';
	let content = `# ${repo}/${path || ''}\n\n`;
	content += `**Branch:** ${ref}\n`;
	content += `**Path:** ${displayPath}\n\n`;
	content += `---\n\n`;
	content += `## Contents\n\n`;

	for (const entry of entries) {
		const icon = entry.type === 'dir' ? '📁' : getFileIcon(entry.name);
		const size = entry.type === 'file' ? ` (${formatFileSize(entry.size)})` : '';
		const link = entry.html_url.replace('github.com', 'github.com');
		content += `- ${icon} [${entry.name}](${link})${size}\n`;
	}

	const finalUrl = `https://github.com/${repo}/tree/${ref}/${path}`;

	return {
		content: content.trim(),
		metadata: {
			title: path ? `${path} - ${repo}` : repo,
			excerpt: `${entries.length} items`,
		},
		finalUrl,
		status: 200,
		contentType: 'text/markdown',
		extractionMethod: 'gh-api-contents',
		providerName: 'gh-cli',
	};
}

/**
 * Fetch file contents using GitHub API
 */
export async function fetchFile(
	gh: string,
	repo: string,
	ref: string,
	path: string,
	timeout: number,
): Promise<ProviderFetchResult> {
	const apiPath = `/repos/${repo}/contents/${path}`;
	// Add ref as query parameter
	const fullPath = `${apiPath}?ref=${ref}`;
	const args = ['api', fullPath, '--jq', '.'];

	const output = await execGh(gh, args, timeout);
	const data = JSON.parse(output);

	const fileName = path.split('/').pop() || path;
	const isImage = isImageFile(fileName);
	const isMarkdown = isMarkdownFile(fileName);
	const isCode = isCodeFile(fileName);

	let content = `# ${fileName}\n\n`;
	content += `**Repository:** ${repo}\n`;
	content += `**Path:** ${path}\n`;
	content += `**Branch:** ${ref}\n`;
	content += `**Size:** ${formatFileSize(data.size)}\n`;
	content += `**SHA:** ${data.sha?.slice(0, 7) || 'unknown'}\n\n`;
	content += `[Open in GitHub](${data.html_url})\n\n`;
	content += `---\n\n`;

	// For images, link to raw instead of embedding
	if (isImage && data.download_url) {
		content += `![${fileName}](${data.download_url})\n\n`;
		content += `*Image: ${fileName}*\n`;
	} else if (isMarkdown || isCode || isTextFile(fileName)) {
		// Fetch raw content for text files
		const rawContent = await fetchRawContent(data.download_url, timeout);
		if (rawContent) {
			// For markdown files, include the content directly
			// For code files, wrap in a code block
			if (isMarkdown) {
				content += `## File Content\n\n`;
				content += rawContent;
			} else {
				const lang = getCodeLanguage(fileName);
				content += `## File Content\n\n`;
				content += `\`\`\`${lang}\n${rawContent}\n\`\`\`\n`;
			}
		}
	} else {
		content += `*Binary file: ${fileName}*\n`;
		if (data.download_url) {
			content += `\n[Download ${fileName}](${data.download_url})\n`;
		}
	}

	return {
		content: content.trim(),
		metadata: {
			title: fileName,
			excerpt: path,
		},
		finalUrl: data.html_url,
		status: 200,
		contentType: 'text/markdown',
		extractionMethod: 'gh-api-contents',
		providerName: 'gh-cli',
	};
}

/**
 * Fetch raw file content using curl via execAsync
 */
export async function fetchRawContent(
	downloadUrl: string | null,
	timeout: number,
): Promise<string | null> {
	if (!downloadUrl) {
		return null;
	}

	try {
		return await execAsync('curl', ['-sL', downloadUrl], { timeout });
	} catch {
		return null;
	}
}

/**
 * Fetch content based on parsed URL type
 */
export async function fetchByType(
	gh: string,
	parsed: ParsedGitHubUrl,
	timeout: number,
	options?: GitHubFetchOptions,
): Promise<ProviderFetchResult> {
	const repo = `${parsed.owner}/${parsed.repo}`;

	if (parsed.type === 'issue' && parsed.number) {
		return fetchIssue(gh, repo, parsed.number, timeout, options);
	}
	if (parsed.type === 'pr' && parsed.number) {
		return fetchPr(gh, repo, parsed.number, timeout, options);
	}
	if (parsed.type === 'repo') {
		return fetchRepo(gh, repo, timeout);
	}
	if (parsed.type === 'tree') {
		return fetchDirectory(gh, repo, parsed.ref || 'main', parsed.path || '', timeout);
	}
	if (parsed.type === 'blob') {
		return fetchFile(gh, repo, parsed.ref || 'main', parsed.path || '', timeout);
	}

	throw new ProviderError(`Unsupported GitHub URL type: ${parsed.type}`, 'gh-cli');
}
