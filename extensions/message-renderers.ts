/**
 * Custom message renderers for webfetch extension.
 */

import { Container, Spacer, Text } from '@mariozechner/pi-tui';
import type { MessageRenderer, ThemeColor } from '@mariozechner/pi-coding-agent';

// Preview line limit when not expanded
const PREVIEW_LINES = 30;

interface WebfetchDetails {
	url: string;
	provider?: string;
	contentType?: string;
	fetchTime?: number;
	processedAs?: string;
}

interface WebfetchMessage {
	customType: string;
	content: string | Array<{ type: string; text: string }>;
	display: boolean;
	details?: WebfetchDetails;
}

/**
 * Check if content is a research result
 */
function isResearchResult(content: string): boolean {
	return content.includes('## Research Result');
}

/**
 * Extract command line from research result content
 */
function extractCommand(content: string): string | null {
	const match = content.match(/\*\*Command:\*\* (.+)/);
	return match ? match[1].trim() : null;
}

/**
 * Render research result with special styling
 */
function renderResearchResult(
	content: string,
	expanded: boolean,
	theme: { fg: (color: ThemeColor, text: string) => string; bold: (text: string) => string },
): Container {
	const container = new Container();
	container.addChild(new Spacer(1));

	// Extract command and analysis
	const command = extractCommand(content);
	const dividerIndex = content.indexOf('---');
	const analysis = dividerIndex > 0 ? content.slice(dividerIndex + 4).trim() : content;

	// Top border with special color for research
	container.addChild(new Text(theme.fg('success', '━'.repeat(60)), 1, 0));

	// Header with emoji
	const headerText = theme.fg('success', theme.bold('🔍 Research Result'));
	container.addChild(new Text(headerText, 1, 0));

	// Command line
	if (command) {
		container.addChild(new Text('', 1, 0));
		container.addChild(new Text(theme.fg('accent', command), 1, 0));
	}

	// Divider
	container.addChild(new Text('', 1, 0));
	container.addChild(new Text(theme.fg('border', '─'.repeat(40)), 1, 0));

	// Analysis content
	const analysisLines = analysis.split('\n');
	const displayLines = expanded ? analysisLines : analysisLines.slice(-PREVIEW_LINES);
	const hiddenLineCount = Math.max(0, analysisLines.length - PREVIEW_LINES);

	if (displayLines.length > 0) {
		container.addChild(new Text('', 1, 0));
		for (const line of displayLines) {
			// Style markdown headers
			if (line.startsWith('## ')) {
				container.addChild(new Text(theme.fg('accent', theme.bold(line)), 1, 0));
			} else if (line.startsWith('### ')) {
				container.addChild(new Text(theme.fg('accent', line), 1, 0));
			} else if (line.startsWith('**') && line.endsWith('**')) {
				// Bold labels
				container.addChild(new Text(theme.fg('muted', line), 1, 0));
			} else if (line.startsWith('- ')) {
				container.addChild(new Text(theme.fg('text', line), 1, 0));
			} else {
				container.addChild(new Text(theme.fg('text', line), 1, 0));
			}
		}
	}

	// Hidden lines indicator
	if (hiddenLineCount > 0 && !expanded) {
		container.addChild(new Text('', 1, 0));
		container.addChild(new Text(theme.fg('muted', `... ${hiddenLineCount} more lines`), 1, 0));
	}

	// Bottom border
	container.addChild(new Text('', 1, 0));
	container.addChild(new Text(theme.fg('success', '━'.repeat(60)), 1, 0));

	return container;
}

export const webfetchResultRenderer: MessageRenderer<WebfetchDetails> = (
	message,
	options,
	theme,
) => {
	const msg = message as unknown as WebfetchMessage;
	const details = msg.details as WebfetchDetails | undefined;
	const url = details?.url ?? 'unknown';
	const processedAs = details?.processedAs;
	const content =
		typeof msg.content === 'string'
			? msg.content
			: ((msg.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')
					?.text ?? '');

	// Use special renderer for research results
	if (processedAs === 'research' || isResearchResult(content)) {
		return renderResearchResult(content, options.expanded, theme);
	}

	const lines = content.split('\n');
	const expanded = options.expanded;
	const displayLines = expanded ? lines : lines.slice(-PREVIEW_LINES);
	const hiddenLineCount = expanded ? 0 : Math.max(0, lines.length - PREVIEW_LINES);

	const container = new Container();
	container.addChild(new Spacer(1));

	// Top border
	container.addChild(new Text(theme.fg('border', '─'.repeat(60)), 1, 0));

	// Header with URL
	const headerText = theme.fg('accent', theme.bold(`🌐 /webfetch ${url}`));
	container.addChild(new Text(headerText, 1, 0));

	// Content
	if (displayLines.length > 0) {
		const contentText = displayLines.map((line) => theme.fg('muted', line)).join('\n');
		container.addChild(new Text(`\n${contentText}`, 1, 0));
	}

	// Hidden lines indicator
	if (hiddenLineCount > 0) {
		const hint = expanded
			? theme.fg('muted', `[${hiddenLineCount} lines hidden]`)
			: theme.fg('muted', `... ${hiddenLineCount} more lines`);
		container.addChild(new Text(`\n${hint}`, 1, 0));
	}

	// Bottom border
	container.addChild(new Text(theme.fg('border', '─'.repeat(60)), 1, 0));

	return container;
};
