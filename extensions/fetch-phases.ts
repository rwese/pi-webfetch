/**
 * Fetch Phases
 *
 * Defines the phases of fetch operations for status tracking.
 */

/** Extended fetch phases for detailed status updates.
 *
 *  Includes tool-level phases from the JSON-RPC subagent
 *  (`'reading'` for `read` / `grep` / `find` / `ls`,
 *  `'executing'` for `bash`, `'thinking'` for everything else).
 *  The subagent's tool events are mapped to these phases so the
 *  parent can render live progress without inventing a separate
 *  vocabulary. See `docs/plans/PLAN_PI_JSONRPC.md` for the
 *  protocol details. */
export type FetchPhase =
	| 'idle'
	| 'starting'
	| 'detecting-provider'
	| 'fetching'
	| 'processing'
	| 'reading'
	| 'analyzing'
	| 'executing'
	| 'thinking'
	| 'streaming'
	| 'complete'
	| 'error';

/** Phase labels for TUI tool output rendering */
export const FETCH_PHASE_LABELS: Record<FetchPhase, string> = {
	idle: '⏳ Working...',
	starting: '⏳ Starting...',
	'detecting-provider': '🔍 Detecting provider...',
	fetching: '🌐 Fetching...',
	processing: '⚙️ Processing...',
	reading: '📖 Reading input...',
	analyzing: '🧠 Analyzing...',
	executing: '🔧 Running command...',
	thinking: '💭 Thinking...',
	streaming: '📝 Generating...',
	complete: '✅ Complete',
	error: '❌ Error',
};

/** Phase labels for command status bar (includes query context) */
export function getCommandPhaseLabel(phase: FetchPhase, hasQuery: boolean): string {
	const labels: Record<FetchPhase, string> = {
		idle: hasQuery ? '🔍 Researching...' : '🌐 Fetching...',
		starting: hasQuery ? '🔍 Starting research...' : '🌐 Starting fetch...',
		'detecting-provider': '🔍 Detecting provider...',
		fetching: '🌐 Fetching content...',
		processing: '⚙️ Processing content...',
		reading: '📖 Reading input...',
		analyzing: '🧠 Analyzing content...',
		executing: '🔧 Running command...',
		thinking: '💭 Thinking...',
		streaming: '📝 Generating response...',
		complete: '✅ Complete',
		error: '❌ Error',
	};
	return labels[phase];
}
