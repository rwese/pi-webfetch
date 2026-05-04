/**
 * Download File Tool Registration
 *
 * Registers the download-file tool for downloading files to temp location.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { downloadFile } from '../fetch.js';

/**
 * Download file tool parameters schema
 */
export const DOWNLOAD_FILE_TOOL_PARAMS = Type.Object({
	url: Type.String({ description: 'The URL to download' }),
});

/**
 * Register the download-file tool with the pi extension
 */
export function registerDownloadFileTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'download-file',
		label: 'Download File',
		description: 'Download a file from URL to temp location',
		parameters: DOWNLOAD_FILE_TOOL_PARAMS,
		async execute(_toolCallId, params, _signal) {
			const result = await downloadFile(params.url);
			return {
				content: [{ type: 'text', text: `File saved to: ${result.tempPath}` }],
				details: {
					url: params.url,
					tempPath: result.tempPath,
					contentType: result.contentType,
				},
			};
		},
	});
}
