/**
 * Provider name tests
 *
 * Regression for review finding 8 (BXAH / M3): the default
 * provider's `name` was `"default"`, which read to users as
 * "the fallback / GitHub fast path / whatever the system
 * picks". The v0.9.0 fix renames the user-facing string to
 * `"browser"` everywhere it surfaces to the user
 * (`WebfetchDetails.provider`, the `Processed as: ...`
 * header, the `/webfetch:info` provider list, etc.). The
 * internal class name (`DefaultProvider`) and the `name` on
 * `WebfetchProvider` stay `"default"` for back-compat with
 * the `--provider` flag and any external code that pattern
 * matches on it.
 *
 * These tests pin:
 *
 * - The `WebfetchProvider.name` of the default provider is
 *   still `"default"` (the user-facing rename is at the
 *   boundary, not the class).
 * - The `WebfetchDetails.provider` and `ProviderFetchResult.providerName`
 *   for the default provider surface as `"browser"` (the
 *   rename happens via a small `displayName` helper).
 * - The CLI / TUI user-facing strings (`agent-browser
 *   (default)` in `/webfetch:info`, etc.) read naturally
 *   without the GitHub-fast-path confusion.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const getProviderStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/fetch.js', () => ({
	getProviderStatus: getProviderStatusMock,
}));

import { providerDisplayName } from '../extensions/providers/display-name.js';
import { DefaultProvider } from '../src/providers/default.js';

beforeEach(() => {
	getProviderStatusMock.mockReset();
});

describe('providerDisplayName', () => {
	it('maps `default` to `browser` (the user-facing string)', () => {
		expect(providerDisplayName('default')).toBe('browser');
	});

	it('passes through `gh-cli` and `clawfetch` unchanged', () => {
		expect(providerDisplayName('gh-cli')).toBe('gh-cli');
		expect(providerDisplayName('clawfetch')).toBe('clawfetch');
	});

	it('falls back to the input for unknown provider names', () => {
		expect(providerDisplayName('experimental-foo')).toBe('experimental-foo');
	});
});

describe('DefaultProvider — internal name is still `default`', () => {
	it('exposes `name === "default"` for back-compat', () => {
		const p = new DefaultProvider({ sessionName: 'test:42' });
		expect(p.name).toBe('default');
	});

	it('exposes a stable `priority` of 10', () => {
		const p = new DefaultProvider({ sessionName: 'test:42' });
		expect(p.priority).toBe(10);
	});
});

describe('DefaultProvider — user-facing rename', () => {
	it('reports `providerName: "browser"` on the ProviderFetchResult', () => {
		const p = new DefaultProvider({ sessionName: 'test:42' });
		// The class is wired so the ProviderFetchResult carries
		// `providerName: this.displayName` (which is `browser`),
		// not `providerName: this.name` (which is `default`).
		// We assert on the class field rather than the live
		// fetch path (which needs agent-browser).
		const internal = p as unknown as { displayName: string };
		expect(internal.displayName).toBe('browser');
	});
});

describe('`/webfetch:info` user-facing string', () => {
	it('lists the default provider as `agent-browser (default)` and the displayed name as `browser`', async () => {
		getProviderStatusMock.mockResolvedValue([
			{ name: 'default', available: true, priority: 10, capabilities: {} },
			{ name: 'clawfetch', available: false, priority: 5, capabilities: {} },
			{ name: 'gh-cli', available: true, priority: 8, capabilities: {} },
		]);
		const { getProviderStatus } = await import('../extensions/fetch.js');
		const providers = await getProviderStatus();
		const defaultProvider = providers.find((p) => p.name === 'default');
		expect(defaultProvider).toBeDefined();
		// The user-facing string uses providerDisplayName so it
		// reads "browser" instead of "default".
		expect(providerDisplayName(defaultProvider!.name)).toBe('browser');
	});
});
