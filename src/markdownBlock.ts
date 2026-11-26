import * as MarkdownIt from "markdown-it";

const markdown = new MarkdownIt("commonmark");

interface D2MarkdownBlock {
  openingLine: number;
  closingLine: number;
  source: string;
  indent: string;
}

export function findD2MarkdownBlock(
  text: string,
  firstLine: number,
  lastLine: number
): D2MarkdownBlock | undefined {
  for (const token of markdown.parse(text, {})) {
    if (token.type !== "fence" || !token.map || !/^d2(?:\s|$)/.test(token.info.trim())) {
      continue;
    }

    const [openingLine, afterBlock] = token.map;
    const closingLine = afterBlock - 1;
    if (firstLine < openingLine || lastLine > closingLine) {
      continue;
    }

    // Markdown also allows an unclosed fence. In that case the last mapped line
    // still belongs to the content, rather than holding a closing marker.
    const source = token.content;
    const bodyLines = source ? source.replace(/\n$/, "").split("\n").length : 0;
    if (closingLine - openingLine !== bodyLines + 1) {
      continue;
    }

    const opener = text.split(/\r\n?|\n/)[openingLine];
    const prefix = opener.slice(0, opener.indexOf(token.markup));
    // List markers on the opening line become spaces on continuation lines.
    // Include a space after tight quote markers so a following indent survives.
    const indent = prefix
      .replace(/>(?![ \t])/g, "> ")
      .replace(/(?:\d{1,9}[.)]|[-+*])(?=[ \t])/g, (marker) => " ".repeat(marker.length));
    return { openingLine, closingLine, source, indent };
  }

  return undefined;
}

export function indentD2MarkdownBlock(
  text: string,
  block: D2MarkdownBlock,
  formatted: string,
  eol: string
): string | undefined {
  const body = formatted
    ? formatted
        .replace(/\n$/, "")
        .split("\n")
        .map((line) => (line ? block.indent + line : block.indent.trimEnd()))
    : [];
  const lines = text.split(/\r\n?|\n/);
  const candidate = [
    ...lines.slice(0, block.openingLine + 1),
    ...body,
    ...lines.slice(block.closingLine),
  ].join("\n");
  const newBlock = findD2MarkdownBlock(candidate, block.openingLine, block.openingLine);
  if (
    newBlock?.source !== formatted ||
    newBlock.closingLine !== block.openingLine + body.length + 1
  ) {
    return undefined;
  }
  return body.length ? body.join(eol) + eol : "";
}
