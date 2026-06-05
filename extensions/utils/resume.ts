/**
 * Resume hint helpers
 *
 * Shared utilities for the agent-error resume flow. The subagent is
 * spawned as a real, named, persistent pi session so users can
 * `pi --session <id>` into the failed transcript. This module produces
 * the deterministic session id, the human-readable session name, and
 * the stable resume hint message.
 *
 * @see docs/plans/PLAN_AGENT_ERROR_RESUME.md
 */

import { createHash } from 'node:crypto';

/** Source where the resume command should run from. */
export type ResumeSource = 'extension' | 'cli' | 'mcp';

/** Inputs for {@link formatResumeHint}. */
export interface ResumeHintInput {
	/** Persistent session id of the spawned subagent. */
	sessionId: string;
	/** Human-readable session name of the spawned subagent. */
	sessionName: string;
	/** Which surface produced the error (extension / CLI / MCP). */
	source: ResumeSource;
	/** The URL that was being researched. */
	url: string;
	/** The research query, if any. */
	query?: string;
	/** The error message thrown by the subagent. */
	errorMessage: string;
}

/** A formatted resume hint, ready to be displayed or persisted. */
export interface ResumeHint {
	/** Stable, multi-line message suitable for a TUI notify or stderr line. */
	message: string;
	/** The exact command the user should run to resume. */
	command: string;
	/** The new `WebfetchDetails` fields ready to be merged into `details`. */
	details: {
		subagentSessionId: string;
		subagentSessionName: string;
		resumeCommand: string;
	};
}

/**
 * Build a stable, unique-per-invocation session id for the spawned
 * subagent. The id is `sha256(timestamp + url + query)` truncated to
 * 16 hex characters. Re-running the same `(now, url, query)` triple
 * yields the same id; changing any input changes the id.
 */
export function deriveSessionId(now: number, url: string, query?: string): string {
	const payload = `${now}\0${url}\0${query ?? ''}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Build a human-readable session name for the spawned subagent. The
 * name shows up in `pi -r` pickers. The host (when available) is the
 * most useful part; we fall back to the first 40 chars of the URL.
 */
export function deriveSessionName(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.host) {
			return `webfetch-research: ${parsed.host}`;
		}
	} catch {
		// Not a parseable URL - fall through to the length-based fallback.
	}
	const fallback = url.length > 40 ? `${url.slice(0, 37)}...` : url;
	return `webfetch-research: ${fallback || 'unknown'}`;
}

/**
 * Format a resume hint for the agent-error path. The message is
 * multi-line and stable so it can be grepped and scripted against.
 * The `command` field depends on the surface:
 *
 *   - extension: `pi --session <id>` (cwd-resumable, from the same dir).
 *   - cli / mcp:  the original `pi-webfetch webfetch <url> --query <q>`
 *     invocation echoed back. A brand new subagent session is created
 *     and resumable from the new failure.
 */
export function formatResumeHint(input: ResumeHintInput): ResumeHint {
	const { sessionId, sessionName, source, url, query, errorMessage } = input;
	const command =
		source === 'extension'
			? `pi --session ${sessionId}`
			: buildCliRerunCommand(url, query);

	const messageParts =
		source === 'extension'
			? [
					'Research subagent failed.',
					`Resume: ${command}`,
					`Session name: ${sessionName}`,
					`Reason: ${errorMessage}`,
				]
			: [
					'Research subagent failed.',
					`Subagent session: ${sessionId}`,
					`Re-run: ${command}`,
					`Reason: ${errorMessage}`,
				];

	return {
		message: messageParts.join('\n'),
		command,
		details: {
			subagentSessionId: sessionId,
			subagentSessionName: sessionName,
			resumeCommand: command,
		},
	};
}

/**
 * Build the CLI / MCP re-run command for the same URL and query.
 * Quotes the URL and query with double quotes and escapes any
 * embedded double quotes so the result is shell-safe.
 */
function buildCliRerunCommand(url: string, query?: string): string {
	const quotedUrl = shellQuote(url);
	if (!query) {
		return `pi-webfetch webfetch ${quotedUrl}`;
	}
	return `pi-webfetch webfetch ${quotedUrl} --query ${shellQuote(query)}`;
}

/** Quote a string for use as a single shell argument (POSIX-style). */
function shellQuote(value: string): string {
	if (value === '') return "''";
	if (/^[A-Za-z0-9_\-./:=?@%+,]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
