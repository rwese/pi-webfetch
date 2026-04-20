# @rwese/pi-webfetch

Webfetch extension for [pi coding agent](https://github.com/badlogic/pi-mono) - fetches remote URLs with browser rendering.

## Features

- **HTML pages** → Browser rendering via `agent-browser` → plain text
- **Plain text** → Returned as-is
- **Binary files** → Downloaded to temp directory
- **Auto-fallback** → Uses static fetch with warning if browser unavailable

## Tools

### `webfetch`

Standard fetch - tries browser first for HTML, auto-fallback.

```
webfetch --url "https://example.com"
```

### `webfetch-spa`

Explicit browser rendering for JavaScript-heavy pages.

```
webfetch-spa --url "https://reddit.com/r/example"
```

**Options:**
- `waitFor` - `"networkidle"` (default) or `"domcontentloaded"`
- `timeout` - Timeout in ms (default: 30000)

**Requires:** `agent-browser` CLI

```bash
npm i -g agent-browser && agent-browser install
```

## How It Works

`webfetch` automatically:
1. Tries `agent-browser` for HTML pages
2. Extracts text from rendered DOM
3. Falls back to static fetch with warning if browser unavailable

## Installation

```bash
npm install @rwese/pi-webfetch
```

## Usage

```
## Fetched: https://example.com
- **Status**: 200
- **Processed as**: spa
⚠️ **Content extracted from body (article/main not found)**
---
[Page content here]
```

## API

```typescript
import { fetchUrl } from "@rwese/pi-webfetch";

const result = await fetchUrl("https://example.com");
// result.content - Array of { type: "text", text: string }
// result.details - { url, contentType, status, processedAs, browserWarning, ... }
```

## Development

```bash
npm install
npm test        # Run tests
npm run validate  # Type check + lint + test
```
