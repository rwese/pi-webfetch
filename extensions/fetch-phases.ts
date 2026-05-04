/**
 * Fetch Phases
 *
 * Defines the phases of fetch operations for status tracking.
 */

/** Extended fetch phases for detailed status updates */
export type FetchPhase =
	| 'idle'
	| 'starting'
	| 'detecting-provider'
	| 'fetching'
	| 'processing'
	| 'analyzing'
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
	analyzing: '🧠 Analyzing...',
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
		analyzing: '🧠 Analyzing content...',
		streaming: '📝 Generating response...',
		complete: '✅ Complete',
		error: '❌ Error',
	};
	return labels[phase];
}
