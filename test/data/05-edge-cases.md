# Edge Cases Test

## Special Characters in Alt Text

![Alt with (parentheses)](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVR42mNk+P+/HgAFhAJ/wlsoBAQAAAQQEBfj6xMoAAAAASUVORK5CYII=)

![Alt with [brackets]](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVR42mNk+P+/HgAFhAJ/wlsoBAQAAAQQEBfj6xMoAAAAASUVORK5CYII=)

![Alt with *asterisks* and $special$ chars](https://example.com/img.png)

## URLs with Special Characters

![Query String](https://example.com/image.png?size=large&format=png)

![Fragment](https://example.com/doc.md#section-heading)

![Combined](https://example.com/img.png?color=red#preview 'With title')

## Nested Brackets Edge Case

![First](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVR42mNk+P+/HgAFhAJ/wlsoBAQAAAQQEBfj6xMoAAAAASUVORK5CYII=)

![Second](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVR42mNk+P+/HgAFhAJ/wlsoBAQAAAQQEBfj6xMoAAAAASUVORK5CYII=)

## Code Block with Markdown-like Content

```typescript
// This looks like a markdown link: [text](url)
// And this looks like an image: ![alt](url)
const code = '[link](url) and ![img](url)';
```

## Anchor in Code Block (should NOT be removed)

```python
# This anchor should stay: [](#anchor)
link = "[](#anchor)"  # This is code, not markdown
```

## Empty and Whitespace

![   spaces in alt   ](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVR42mNk+P+/HgAFhAJ/wlsoBAQAAAQQEBfj6xMoAAAAASUVORK5CYII=)

![](/absolute/path.png)

## Multiple Same URLs

![First occurrence](https://example.com/shared.png)

Some text.

![Second occurrence](https://example.com/shared.png)

More text.

![Third occurrence](https://example.com/shared.png)

## Anchor with Title

[](#anchor 'This is a title')

Regular link [](#another-anchor 'Another title').

## Real URL that looks like anchor

This is a real link: [Real Link](https://example.com/path#anchor-with-hyphen)

And another: [](#id-with-numbers-123)

## Markdown entities (should be preserved)

&copy; 2024

&lt;script&gt;alert('xss')&lt;/script&gt;

&quot;Quoted text&quot;

---

End of edge cases.
