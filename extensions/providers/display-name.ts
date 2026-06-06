/**
 * Provider display-name helper
 *
 * Maps an internal `WebfetchProvider.name` to the user-facing
 * string used in:
 *
 * - `WebfetchDetails.provider`
 * - `ProviderFetchResult.providerName`
 * - The `Processed as: ...` header
 * - The `/webfetch:info` provider list
 * - The MCP / CLI / pi extension output
 *
 * The default provider's internal name stays `"default"` for
 * back-compat with the `--provider default` flag and any
 * external code that pattern-matches on it. The user-facing
 * rename is purely cosmetic and lives at the boundary, not
 * the class.
 */

const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
	default: 'browser',
};

/**
 * Resolve a user-facing name for a provider. Falls back to
 * the input when no override is set so unknown / experimental
 * providers round-trip cleanly.
 */
export function providerDisplayName(name: string | undefined): string {
	if (!name) return '';
	return DISPLAY_NAME_OVERRIDES[name] ?? name;
}
