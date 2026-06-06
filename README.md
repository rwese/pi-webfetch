# @rwese/pi-webfetch

Webfetch extension for [pi coding agent](https://github.com/badlogic/pi-mono) and Codex MCP - fetches remote URLs with browser rendering.

## Features

- **HTML pages** → Browser rendering via `agent-browser` → markdown
- **Plain text** → Returned as-is
- **Binary files** → Downloaded to temp directory
- **Auto-fallback** → Uses static fetch with warning if browser unavailable
- **Hybrid extraction** → Markdown when HTML has good text ratio, text fallback otherwise

## Tools

The same tools are exposed through both the pi extension and the MCP server.

## Direct CLI

Run the package directly from npm:

```bash
npx -y @rwese/pi-webfetch --help
npx -y @rwese/pi-webfetch webfetch "https://example.com"
npx -y @rwese/pi-webfetch webfetch "https://example.com" --query "What is the main topic?"
npx -y @rwese/pi-webfetch spa "https://reddit.com/r/example" --wait-for networkidle
npx -y @rwese/pi-webfetch download "https://example.com/file.pdf"
npx -y @rwese/pi-webfetch providers
npx -y @rwese/pi-webfetch clear-cache --url "https://example.com"
npx -y @rwese/pi-webfetch cache-stats --json
```

After installation, the binary is available as `pi-webfetch`:

```bash
pi-webfetch webfetch "https://example.com" --json
pi-webfetch mcp
```

Use `--json` with non-MCP commands for structured output.

### `webfetch`

Standard fetch - tries browser first for HTML, auto-fallback.

```
webfetch --url "https://example.com"
webfetch --url "https://example.com" --query "What is the main topic?"
webfetch --url "https://github.com/user/repo/issues/123" --provider "gh-cli"
webfetch --url "https://github.com/user/repo/issues/123" --include-comments
```

**Options:**

- `url` - URL to fetch
- `query` - Optional research question for AI analysis
- `provider` - Optional provider override: `"default"`, `"clawfetch"`, or `"gh-cli"`
- `include-comments` - When using the `gh-cli` provider, include issue
  conversation comments and PR review threads. **Default: off** for
  issues and PRs. When off, a `> Tip:` discovery hint is appended to
  the content and surfaced as `details.githubHint` / `metadata.githubHint`.
- `timeout` - Wall-clock budget in milliseconds for the research
  subagent (only used when `query` is set). **Default: 180000**
  (3 min). Increase for large pages or complex queries; the subagent
  is killed with `Pi agent timed out after <ms>ms` if the budget is
  exhausted, and the resumable-session flow (see below) still applies.

### `webfetch-spa`

Explicit browser rendering for JavaScript-heavy pages.

```
webfetch-spa --url "https://reddit.com/r/example"
```

**Options:**

- `waitFor` - `"networkidle"` (default) or `"domcontentloaded"`
- `timeout` - Timeout in ms (default: 30000)

### `download-file`

Download a file from a URL to a temp location.

```
download-file --url "https://example.com/file.pdf"
```

**Requires:** `agent-browser` CLI

```bash
npm i -g agent-browser && agent-browser install
```

### `webfetch-providers`

Check installed providers and their priorities.

```
webfetch-providers
```

### `webfetch-clear-cache`

Clear one cached URL or all cached content.

```
webfetch-clear-cache --url "https://example.com"
webfetch-clear-cache
```

### `webfetch-cache-stats`

Show cache item count and total size.

```
webfetch-cache-stats
```

## Codex MCP Server

This package includes a Codex plugin manifest at `.codex-plugin/plugin.json` and an MCP config at `.mcp.json`.

Start the published MCP server:

```bash
npx -y @rwese/pi-webfetch mcp
```

Start the local development MCP server from the repository root:

```bash
npm install
npm run mcp
```

The server uses stdio transport and is intended to be launched by an MCP client. For Codex plugin usage, point Codex at this repository as a local plugin; Codex reads `.codex-plugin/plugin.json`, then starts the server using `.mcp.json`.

Manual MCP config:

```json
{
	"mcpServers": {
		"pi-webfetch": {
			"command": "npx",
			"args": ["-y", "@rwese/pi-webfetch", "mcp"]
		}
	}
}
```

The MCP server exposes:

- `webfetch`
- `webfetch-spa`
- `download-file`
- `webfetch-providers`
- `webfetch-clear-cache`
- `webfetch-cache-stats`

## How It Works

`webfetch` automatically:

1. Probes Content-Type via HEAD request
2. Skips browser for binary types (PDF, ZIP, images, etc.)
3. Tries `agent-browser` for HTML pages
4. Extracts HTML → converts to markdown via turndown
5. Falls back to text extraction if HTML quality is poor
6. Falls back to static fetch with warning if browser unavailable

For GitHub URLs, the `gh-cli` provider is preferred when it is available
and authenticated. By default, issue and PR fetches return the issue/PR
body plus metadata; passing `--include-comments` (or `includeComments:
true` from MCP / the pi extension) adds the conversation comments and
PR review threads. When the option is off, a `> Tip:` discovery hint
is appended to the markdown content and also surfaced via
`details.githubHint` / `metadata.githubHint` so programmatic callers
can prompt the user to opt in.

## Resuming a Failed Research Subagent

When research mode spawns the analysis subagent, it launches as a
real, named, persistent pi session (`pi -p --name "<n>" --session-id
"<id>" "<prompt>"`). The session id is
`sha256(timestamp + url + query)` truncated to 16 hex chars, so each
invocation gets its own resumable session. If the subagent fails:

- **In a pi session (the extension):** a TUI notification shows
  `pi --session <id>`. From the same working directory, run
  `pi --session <id>` (or use `pi -r` and pick the session by name)
  to open the failed subagent's transcript — it contains the URL,
  the query, the fetched content, and the partial analysis.
- **From the CLI / MCP:** a stderr line (CLI) or `_meta.details.notify`
  (MCP) shows the synthesized session id and the re-run command
  `pi-webfetch webfetch <url> --query <query>`. A brand new
  subagent session is created on the next call and is itself
  resumable.

The fallback markdown in the agent's context is intentionally
byte-identical to the pre-change baseline: the resume hint is
carried in `WebfetchDetails` (`subagentSessionId`,
`subagentSessionName`, `resumeCommand`) and in a side-channel
`notify` so the conversation is not polluted.

## Research Subagent Input Files

Research mode writes the fetched content to a session-keyed work
dir under the system temp dir, so the subagent can `read` /
`grep` the content on demand instead of receiving the full
content inline. The layout is:

```
<tmpdir>/pi-webfetch-research/<sessionId>/
  input.md            # processed markdown (always written)
  input_raw.<ext>     # original response (when available; .html / .md / .txt / .json / .bin)
```

The session id is the same `sha256(timestamp + url + query)` id
used for the subagent's `--session-id`, so `pi --session <id>`
locates the same files. The paths surface on the result
`WebfetchDetails` as `workDir`, `inputFile`, and `inputRawFile`,
and the lean prompt references them. The raw input is populated
by the browser (`default`) and static fetch providers; gh-cli
and clawfetch leave it `undefined` (their output is already
clean structured markdown).


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
import { fetchUrl, downloadFile } from '@rwese/pi-webfetch';

// Fetch URL
const result = await fetchUrl('https://example.com');
// result.content - Array of { type: "text", text: string }
// result.details - { url, contentType, status, processedAs, browserWarning, ... }

// Download file to temp path
const download = await downloadFile('https://example.com/file.pdf');
// download.tempPath - temp file path
// download.contentType - Content-Type header
```

## Development

```bash
npm install
npm run build
npm test        # Run tests
npm run validate  # Type check + lint + test
```
