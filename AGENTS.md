# pi-webfetch Extension

Fetches remote URLs and processes content:
- **HTML**: Browser rendering via `agent-browser` → plain text
- **Text**: Returned as-is
- **Binary**: Downloaded to temp directory
- **Fallback**: Static fetch with warning if browser unavailable

## Tools

### `webfetch`
Standard fetch - tries browser first for HTML, falls back to static.

**Parameters:**
- `url` (required): The URL to fetch

**Example:**
```
webfetch --url "https://example.com"
```

**Behavior:**
1. Tries `agent-browser` first for HTML pages
2. If browser unavailable/fails, uses static fetch
3. Adds warning header if using fallback

### `webfetch-spa`
Explicit browser rendering (rarely needed now).

**Parameters:**
- `url` (required): The URL to fetch
- `waitFor` (optional): `"networkidle"` (default) or `"domcontentloaded"`
- `timeout` (optional): Timeout in ms (default: 30000)

**Example:**
```
webfetch-spa --url "https://reddit.com/r/example"
```

**Requires:** `agent-browser` CLI
```bash
npm i -g agent-browser && agent-browser install
```

## How It Works

`webfetch` now uses `agent-browser` for HTML pages:
1. Open URL in headless Chrome
2. Wait for JavaScript to render
3. Extract text from `article` → `main` → `body`
4. Return clean text

If browser unavailable or fails:
- Falls back to static HTTP fetch
- Adds warning: `⚠️ Using static fetch`

## Quality Gates

```bash
npm run validate
```

## Development

```bash
npm test        # Run tests
npm run lint    # Lint only
npm run format  # Format
```

## Extension Validation

```bash
pi -e . --offline -p test
```

## When to Use

| Page Type | Tool | Notes |
|-----------|------|-------|
| Any page | `webfetch` | Tries browser first, auto-fallback |
| Explicit SPA | `webfetch-spa` | Force browser rendering |

## Troubleshooting

**Poor results from `webfetch`:**
- Page may need explicit browser: try `webfetch-spa`
- Ensure `agent-browser` installed: `agent-browser --version`
