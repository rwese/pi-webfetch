# TODO: Fix Binary Content Detection & Improve Markdown Extraction

## Completed

### Binary Content Detection (v0.1.0)
- [x] 1. Add early content-type detection using HEAD request
- [x] 2. Skip browser fetch for binary content-types
- [x] 3. Add URL extension check as fallback
- [x] 4. Add test for PDF binary detection
- [x] 5. Test with actual PDF URL

### Hybrid Browser Extraction (v0.2.0)
- [x] Use `get html` from browser instead of `get text`
- [x] Convert HTML to markdown with turndown
- [x] Add text ratio check for content quality
- [x] Fall back to text extraction when HTML is poor quality
- [x] Tested with Google Support (markdown) and MiniMax (text fallback)

## Test Results

| URL | Content Type | Method | Result |
|-----|--------------|--------|--------|
| Google Support | HTML with `<article>` | Markdown | ✅ Preserves headings, lists |
| MiniMax | SPA, no semantic elements | Text fallback | ✅ Clean text |
| NextCloud PDF | Binary PDF | Binary download | ✅ Saved to temp |

## Commits

| Commit | Description |
|--------|-------------|
| `86b59a2` | fix: detect binary content before browser fetch |
| `47395b4` | docs: update TODO with completion status |
| `f9c67f4` | feat: hybrid browser extraction - markdown with text fallback |
