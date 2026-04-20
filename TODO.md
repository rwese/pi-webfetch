# pi-webfetch Extension

## Tools

| Tool | Description |
|------|-------------|
| `webfetch` | Fetch URL, process content (HTML→markdown, binary→temp) |
| `webfetch-spa` | Force browser rendering for JS-heavy pages |
| `download-file` | Download file to specific destination |

## Features

### Binary Content Detection
- Probes Content-Type via HEAD request before browser fetch
- Skips browser for known binary types (PDF, ZIP, images, etc.)
- Falls back to URL extension check

### Hybrid Browser Extraction
- Uses `get html` from browser → converts to markdown
- Falls back to `get text` if HTML is poor quality (low text ratio)

### Download File
- Explicit download to user-specified destination
- Returns success, size, content-type

## Test Results

| URL | Content Type | Method | Result |
|-----|--------------|--------|--------|
| Google Support | HTML with `<article>` | Markdown | ✅ Preserves headings, lists |
| MiniMax | SPA, no semantic elements | Text fallback | ✅ Clean text |
| NextCloud PDF | Binary PDF | Binary download | ✅ Saved to temp |
| PDF (download-file) | Binary PDF | Explicit download | ✅ Saved to `/tmp/test.pdf` |
