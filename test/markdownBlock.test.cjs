const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  findD2MarkdownBlock,
  indentD2MarkdownBlock,
} = require("../node_modules/.cache/d2-test/markdownBlock");

test("locates one D2 fence and ignores other languages and surrounding prose", () => {
  const text = [
    "# Diagram",
    "",
    "```text",
    "keep this as written",
    "```",
    "",
    '~~~~d2 title="Request path"',
    "a->b",
    "~~~~~",
  ].join("\n");
  assert.equal(findD2MarkdownBlock(text, 0, 0), undefined);
  assert.equal(findD2MarkdownBlock(text, 3, 3), undefined);
  assert.equal(findD2MarkdownBlock(text, 3, 7), undefined);
  const block = findD2MarkdownBlock(text, 6, 8);
  assert.deepEqual(block, {
    openingLine: 6,
    closingLine: 8,
    source: "a->b\n",
    indent: "",
  });
  assert.equal(indentD2MarkdownBlock(text, block, "a -> b\n", "\n"), "a -> b\n");
});

test("keeps the list and blockquote indentation and restores CRLF", () => {
  const text = [
    "- Request path",
    "",
    "  > ```d2",
    "  > a->b",
    "  > ```",
    "",
    "- Response path",
  ].join("\r\n");
  const block = findD2MarkdownBlock(text, 3, 3);
  assert.equal(block?.source, "a->b\n");
  assert.equal(
    indentD2MarkdownBlock(text, block, "a -> b\n\nb -> c\n", "\r\n"),
    "  > a -> b\r\n  >\r\n  > b -> c\r\n"
  );
});

test("keeps a fence opened on an ordered list marker inside tight nested quotes", () => {
  const text = [">>1. ```d2", ">>    a->b", ">>    ```"].join("\n");
  const block = findD2MarkdownBlock(text, 1, 1);
  assert.equal(block?.source, "a->b\n");
  assert.equal(indentD2MarkdownBlock(text, block, "a -> b\n", "\n"), "> >    a -> b\n");
});

test("skips unclosed fences and prevents formatting from introducing a closer", () => {
  assert.equal(findD2MarkdownBlock("```d2\na->b", 1, 1), undefined);
  assert.equal(
    findD2MarkdownBlock("> ```d2\n> a->b\n\nOutside the quote", 1, 1),
    undefined
  );
  const text = ["```d2", "a->b", "```"].join("\n");
  const block = findD2MarkdownBlock(text, 1, 1);
  assert.equal(indentD2MarkdownBlock(text, block, "a -> b\n```\n", "\n"), undefined);
  assert.equal(indentD2MarkdownBlock(text, block, "", "\n"), "");
});
