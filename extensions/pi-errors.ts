/**
 * Shared error type for the pi-webfetch research subagent layer.
 *
 * Imported by both `extensions/pi-agent.ts` (public surface) and
 * `extensions/pi-session.ts` (in-process SDK wrapper) without creating a
 * circular dependency between the two.
 */

/**
 * Custom error for research-subagent failures
 */
export class PiAgentError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number | null,
		public readonly stderr?: string,
	) {
		super(message);
		this.name = 'PiAgentError';
	}
}
