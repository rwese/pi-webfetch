/**
 * Provider display-name helper (src side)
 *
 * Mirrors `extensions/providers/display-name.ts` for the
 * src/ tree. The src/ tree is the source of truth for the
 * DefaultProvider; the extensions/ tree is the user-facing
 * boundary (TUI / CLI / MCP). Both files share the same
 * mapping and are kept in sync via this comment + the M3.A
 * tests.
 */

const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
	default: 'browser',
};

export function providerDisplayName(name: string | undefined): string {
	if (!name) return '';
	return DISPLAY_NAME_OVERRIDES[name] ?? name;
}
