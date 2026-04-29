/**
 * Custom message renderers for webfetch extension.
 */

import { Container, Text, type Component } from '@mariozechner/pi-tui';
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
 * Full-width separator component that adapts to terminal width
 */
class FullWidthSeparator implements Component {
	invalidate(): void {}
	render(width: number): string[] {
		// Use Unicode block elements for a clean full-width line
		return ['─'.repeat(width)];
	}
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
	if (!match) return null;
	return match[1].trim();
}

/**
 * Render research result with simple styling
 */
function renderResearchResult(
	content: string,
	expanded: boolean,
	theme: { fg: (color: ThemeColor, text: string) => string; bold: (text: string) => string },
): Container {
	const container = new Container();

	const command = extractCommand(content);
	const dividerIndex = content.indexOf('---');
	const analysis = dividerIndex > 0 ? content.slice(dividerIndex + 4).trim() : content;

	// Full-width separator
	container.addChild(new FullWidthSeparator());

	// Header
	container.addChild(new Text(theme.fg('success', theme.bold('🔍 Research Result')), 1, 0));
	if (command) {
		container.addChild(new Text(theme.fg('accent', command), 1, 0));
	}

	// Analysis content
	const analysisLines = analysis.split('\n');
	const displayLines = expanded ? analysisLines : analysisLines.slice(-PREVIEW_LINES);
	const hiddenLineCount = Math.max(0, analysisLines.length - PREVIEW_LINES);

	if (displayLines.length > 0) {
		container.addChild(new Text('', 1, 0));
		for (const line of displayLines) {
			container.addChild(new Text(theme.fg('text', line), 1, 0));
		}
	}

	if (hiddenLineCount > 0 && !expanded) {
		container.addChild(new Text('', 1, 0));
		container.addChild(new Text(theme.fg('muted', `[${hiddenLineCount} more lines]`), 1, 0));
	}

	// Full-width separator
	container.addChild(new FullWidthSeparator());

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
	const provider = details?.provider;
	const content =
		typeof msg.content === 'string'
			? msg.content
			: ((msg.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')
					?.text ?? '');

	if (processedAs === 'research' || isResearchResult(content)) {
		return renderResearchResult(content, options.expanded, theme);
	}

	const lines = content.split('\n');
	const expanded = options.expanded;
	const displayLines = expanded ? lines : lines.slice(-PREVIEW_LINES);
	const hiddenLineCount = expanded ? 0 : Math.max(0, lines.length - PREVIEW_LINES);

	const container = new Container();

	// Full-width separator
	container.addChild(new FullWidthSeparator());

	// Header
	container.addChild(new Text(theme.fg('accent', theme.bold(`🌐 Fetch Result: ${url}`)), 1, 0));
	if (provider) {
		container.addChild(new Text(theme.fg('muted', `Provider: ${provider}`), 1, 0));
	}

	// Content
	if (displayLines.length > 0) {
		container.addChild(new Text('', 1, 0));
		for (const line of displayLines) {
			container.addChild(new Text(theme.fg('text', line), 1, 0));
		}
	}

	if (hiddenLineCount > 0) {
		container.addChild(new Text('', 1, 0));
		const hint = expanded
			? theme.fg('muted', `[${hiddenLineCount} lines hidden]`)
			: theme.fg('muted', `[${hiddenLineCount} more lines]`);
		container.addChild(new Text(hint, 1, 0));
	}

	// Full-width separator
	container.addChild(new FullWidthSeparator());

	return container;
};
