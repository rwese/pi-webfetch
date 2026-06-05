import { describe, it, expect, vi } from 'vitest';
import {
	deriveSessionId,
	deriveSessionName,
	formatResumeHint,
} from '../extensions/utils/resume.js';

describe('deriveSessionId', () => {
	it('returns 16 hex characters', () => {
		const id = deriveSessionId(1700000000000, 'https://example.com', 'summarize');
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});

	it('is deterministic for the same inputs', () => {
		const now = 1700000000000;
		const a = deriveSessionId(now, 'https://example.com', 'summarize');
		const b = deriveSessionId(now, 'https://example.com', 'summarize');
		expect(a).toBe(b);
	});

	it('changes when the timestamp changes', () => {
		const url = 'https://example.com';
		const query = 'summarize';
		const a = deriveSessionId(1700000000000, url, query);
		const b = deriveSessionId(1700000000001, url, query);
		expect(a).not.toBe(b);
	});

	it('changes when the URL changes', () => {
		const now = 1700000000000;
		const query = 'summarize';
		expect(deriveSessionId(now, 'https://a.example', query)).not.toBe(
			deriveSessionId(now, 'https://b.example', query),
		);
	});

	it('changes when the query changes', () => {
		const now = 1700000000000;
		const url = 'https://example.com';
		expect(deriveSessionId(now, url, 'a')).not.toBe(deriveSessionId(now, url, 'b'));
	});
});

describe('deriveSessionName', () => {
	it('uses the URL host when parseable', () => {
		expect(deriveSessionName('https://example.com/foo/bar')).toBe(
			'webfetch-research: example.com',
		);
	});

	it('falls back to a length-trimmed URL when not parseable', () => {
		const longUrl = 'not-a-url-' + 'x'.repeat(60);
		const name = deriveSessionName(longUrl);
		expect(name.startsWith('webfetch-research: ')).toBe(true);
		expect(name.length).toBeLessThanOrEqual('webfetch-research: '.length + 40);
	});

	it('handles short non-URL strings', () => {
		expect(deriveSessionName('abc')).toBe('webfetch-research: abc');
	});
});

describe('formatResumeHint', () => {
	const baseInput = {
		sessionId: '0123456789abcdef',
		sessionName: 'webfetch-research: example.com',
		url: 'https://example.com/page',
		query: 'summarize this',
		errorMessage: 'spawn failed',
	};

	it('returns a pi --session command for the extension source', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'extension' });
		expect(hint.command).toBe('pi --session 0123456789abcdef');
		expect(hint.details.resumeCommand).toBe('pi --session 0123456789abcdef');
		expect(hint.message).toContain('Resume: pi --session 0123456789abcdef');
		expect(hint.message).toContain('Session name: webfetch-research: example.com');
		expect(hint.message).toContain('Reason: spawn failed');
		expect(hint.message.startsWith('Research subagent failed.')).toBe(true);
	});

	it('returns a pi-webfetch rerun command for the cli source', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'cli' });
		expect(hint.command).toBe(
			"pi-webfetch webfetch https://example.com/page --query 'summarize this'",
		);
		expect(hint.message).toContain('Subagent session: 0123456789abcdef');
		expect(hint.message).toContain('Re-run: pi-webfetch webfetch');
	});

	it('returns a pi-webfetch rerun command for the mcp source', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'mcp' });
		expect(hint.command).toBe(
			"pi-webfetch webfetch https://example.com/page --query 'summarize this'",
		);
	});

	it('omits the --query flag when the query is missing (cli source)', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'cli', query: undefined });
		expect(hint.command).toBe('pi-webfetch webfetch https://example.com/page');
	});

	it('mirrors the new details fields', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'extension' });
		expect(hint.details.subagentSessionId).toBe('0123456789abcdef');
		expect(hint.details.subagentSessionName).toBe('webfetch-research: example.com');
	});

	it('uses a stable, multi-line message format', () => {
		const hint = formatResumeHint({ ...baseInput, source: 'extension' });
		const lines = hint.message.split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[0]).toBe('Research subagent failed.');
	});
});

describe('formatResumeHint integration with deriveSessionId/Name', () => {
	it('produces a hint that opens the same session id webfetchResearch would derive', () => {
		const now = 1700000000000;
		const url = 'https://example.com';
		const query = 'summarize';
		const id = deriveSessionId(now, url, query);
		const name = deriveSessionName(url);
		const hint = formatResumeHint({
			sessionId: id,
			sessionName: name,
			source: 'extension',
			url,
			query,
			errorMessage: 'boom',
		});
		expect(hint.details.subagentSessionId).toBe(id);
		expect(hint.details.subagentSessionName).toBe(name);
	});

	it('re-runs produce stable session ids for the same now/URL/query', () => {
		const fixedNow = vi.fn(() => 1700000000000);
		const id1 = deriveSessionId(fixedNow(), 'https://example.com', 'q');
		const id2 = deriveSessionId(fixedNow(), 'https://example.com', 'q');
		expect(id1).toBe(id2);
	});
});
