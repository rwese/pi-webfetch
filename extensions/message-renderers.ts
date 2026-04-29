/**
 * Custom message renderers for webfetch extension.
 */

import { Container, Spacer, Text } from '@mariozechner/pi-tui';
import type { MessageRenderer } from '@mariozechner/pi-coding-agent';

// Preview line limit when not expanded
const PREVIEW_LINES = 30;

interface WebfetchDetails {
	url: string;
	provider?: string;
	contentType?: string;
	fetchTime?: number;
}

interface WebfetchMessage {
	customType: string;
	content: string | Array<{ type: string; text: string }>;
	display: boolean;
	details?: WebfetchDetails;
}

export const webfetchResultRenderer: MessageRenderer<WebfetchDetails> = (
	message,
	options,
	theme,
) => {
	const msg = message as unknown as WebfetchMessage;
	const details = msg.details as WebfetchDetails | undefined;
	const url = details?.url ?? 'unknown';
	const content =
		typeof msg.content === 'string'
			? msg.content
			: ((msg.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')
					?.text ?? '');

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
