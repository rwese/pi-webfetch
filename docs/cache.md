# Webfetch cache

The webfetch cache is a flat file store of JSON entries
keyed by `(url, options hash)`. It is intentionally simple:
one file per `(URL, options)` combination, no SQLite, no
index, no expiry daemon. The TTL / content-validation /
per-process isolation invariants in v0.9.0 (M1) keep the
cache correct without those moving parts.

## On-disk layout

```
<tmpdir>/pi-webfetch-cache/
  <sha256(url)>.json     # the entry
  <sha256(url)>.json.bak # last-known-good, only on bad write
```

Each entry is a `CacheEntry`:

```ts
interface CacheEntry {
  url: string;
  content: string;
  contentType: string | null;
  status: number;
  cachedAt: number; // ms since epoch
  finalUrl?: string; // post-redirect URL, when the provider surfaces it
  pageTitle?: string; // rendered <title>, when the provider surfaces it
  rawContent?: string; // original response (HTML, text, JSON)
  rawContentType?: string | null;
  provider?: string;
  extractionMethod?: string;
}
```

`finalUrl` / `pageTitle` are content-validation signals. See
[Content validation](#content-validation) below.

## TTL (v0.9.0)

`isFresh(entry, now, ttlMs?)` returns `true` when the entry
is still inside the TTL window. The default TTL is one hour
(`DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000`). A non-positive
`ttlMs` is treated as "always stale" — there is no "no TTL"
mode.

| Surface | Flag / field | Default |
|---------|--------------|---------|
| CLI | `--cache-ttl <ms>` | 3,600,000 |
| MCP `webfetch` tool | `cacheTtlMs` (int, positive) | 3,600,000 |
| pi extension tool | `cacheTtlMs` (Type.Integer) | 3,600,000 |
| In-process `fetchUrl` | `options.cacheTtlMs` | 3,600,000 |
| In-process `fetchUrl` | `options.cacheNow` (clock injection) | `Date.now` |

`fetchUrl` honours a per-call clock injection (`options.cacheNow`)
so tests can assert "fresh" / "stale" / "override" without
mutating the system clock.

## Content validation (v0.9.0)

A race condition between concurrent fetches (e.g. a shared
browser tab on the previous version) can cause the provider
to extract HTML for the wrong URL. Even with the per-tab fix
in v0.9.0 (see [Per-process / per-tab
isolation](#per-process--per-tab-isolation) below), the cache
layer is the second line of defence:

`validateCacheEntry(entry, requestedUrl)` returns `{ valid: false, reason }` when:

- the provider's `finalUrl` (post-redirect URL) is a
  different host or path than the requested URL, or
- the rendered `<title>` (either from `entry.pageTitle` or
  extracted from `entry.rawContent`) does not fuzzy-match
  the requested URL's last path segment.

A mismatch rejects the **cache write** (the original
`FetchResult` flows through unchanged) and:

- fires a `notify` callback when one is supplied, and
- mirrors the warning onto `WebfetchDetails.notify` so the
  CLI / MCP / extension surfaces can show it.

The validation is a "warn and skip persist", never a
re-throw.

## Per-process / per-tab isolation (v0.9.0)

The default provider owns a `BrowserManager` that:

- Computes its `AGENT_BROWSER_SESSION` once in the
  constructor as `${os.hostname()}:${process.pid}`. Two
  concurrent `webfetch` processes on the same host each
  get their own browser instance.
- Allocates a fresh tab per fetch
  (`agent-browser tab new <url> --label webfetch-<uuid>`),
  closes the tab in `finally` (even on extraction errors).

This closes the race window that allowed the v0.8.0
"poisoned-cache" case: a `currentUrl` skip-open shortcut
could read HTML for the wrong page when a `agent-browser
open` returned before the new page had committed.

## Clear-cache batch UX (v0.9.0)

`webfetch-clear-cache` gained three flags:

| Flag | Effect |
|------|--------|
| `--all` | Clear every cached entry. |
| `--older-than <duration>` | Clear entries whose `cachedAt` is at least the given duration in the past. Accepts `7d`, `2h`, `30m`, `45s`, `1500ms`, or a bare integer in ms. |
| `--dry-run` | Describe what would be removed without actually deleting. |

The same flags work in the CLI (`pi-webfetch clear-cache …`),
the TUI (`/webfetch-clear-cache …`), and the underlying
`clearAllCache({ olderThanMs })` /
`clearCacheOlderThan(url, ms)` helpers.

## CLI examples

```sh
# Standard fetch with the default 1h cache TTL.
pi-webfetch webfetch https://example.com

# Tighten the cache TTL to 30s for a specific call.
pi-webfetch webfetch https://example.com --cache-ttl 30000

# Drop everything older than a week, dry-run first.
pi-webfetch clear-cache --older-than 7d --dry-run
pi-webfetch clear-cache --older-than 7d

# Drop everything (with confirmation via --all).
pi-webfetch clear-cache --all
```

## MCP examples

```jsonc
// webfetch tool with a custom cache TTL.
{
  "name": "webfetch",
  "arguments": {
    "url": "https://example.com",
    "cacheTtlMs": 30000
  }
}
```

## Programmatic API

```ts
import {
  isFresh,
  DEFAULT_CACHE_TTL_MS,
  parseDurationToMs,
  clearAllCache,
  clearCacheOlderThan,
} from '@rwese/pi-webfetch';

// Read with a custom TTL.
if (isFresh(entry, Date.now(), 5 * 60 * 1000)) {
  // use entry.content
}

// Parse a human-friendly duration.
const ms = parseDurationToMs('7d'); // 604_800_000

// Drop stale entries.
await clearAllCache({ olderThanMs: 7 * 24 * 60 * 60 * 1000 });
```
