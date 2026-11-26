import { execFile } from "child_process";
import {
  CancellationToken,
  EndOfLine,
  FormattingOptions,
  Range,
  TextDocument,
  TextEdit,
  Uri,
  window,
  workspace,
} from "vscode";
import { outputChannel } from "./extension";
import { findD2MarkdownBlock, indentD2MarkdownBlock } from "./markdownBlock";

function formatSource(source: string, uri: Uri): Promise<string> {
  const executable = workspace.getConfiguration("D2", uri).get("execPath", "d2");
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      ["fmt", "-"],
      { encoding: "utf8", maxBuffer: 24 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        // Older D2 versions write nothing for already formatted input. Empty
        // output can safely clear a buffer containing only D2 whitespace.
        resolve(stdout === "" && /[^ \t\r\n]/.test(source) ? source : stdout);
      }
    );
    // A failed subprocess can close stdin before it has read the document.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(source);
  });
}

export async function formatD2Document(
  document: TextDocument,
  _options: FormattingOptions,
  token: CancellationToken
): Promise<TextEdit[]> {
  const version = document.version;
  const source = document.getText();
  try {
    const formatted = await formatSource(source, document.uri);
    const eol = document.eol === EndOfLine.CRLF ? "\r\n" : "\n";
    const result = formatted.replace(/\r?\n/g, eol);
    if (
      result === source ||
      token.isCancellationRequested ||
      document.isClosed ||
      document.version !== version
    ) {
      return [];
    }
    const range = new Range(document.positionAt(0), document.positionAt(source.length));
    return [TextEdit.replace(range, result)];
  } catch (error) {
    if (
      !token.isCancellationRequested &&
      !document.isClosed &&
      document.version === version
    ) {
      outputChannel.appendError(String(error));
    }
    return [];
  }
}

export async function formatD2Block(): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    return;
  }

  const { document, selection } = editor;
  const version = document.version;
  const text = document.getText();
  const lastLine =
    !selection.isEmpty && selection.end.character === 0
      ? selection.end.line - 1
      : selection.end.line;
  const block =
    editor.selections.length === 1
      ? findD2MarkdownBlock(text, selection.start.line, lastLine)
      : undefined;
  if (!block) {
    window.showInformationMessage(
      "Place the cursor or selection in one closed D2 block."
    );
    return;
  }

  try {
    const formatted = await formatSource(block.source, document.uri);
    if (formatted === block.source || document.isClosed || document.version !== version) {
      return;
    }
    const eol = document.eol === EndOfLine.CRLF ? "\r\n" : "\n";
    const body = indentD2MarkdownBlock(text, block, formatted, eol);
    if (body === undefined) {
      window.showErrorMessage(
        "Could not format this D2 block without changing its Markdown fence."
      );
      return;
    }
    const range = new Range(block.openingLine + 1, 0, block.closingLine, 0);
    await editor.edit((edit) => edit.replace(range, body));
  } catch (error) {
    if (!document.isClosed && document.version === version) {
      outputChannel.appendError(String(error));
      window.showErrorMessage(
        "Could not format this D2 block. See D2-Output for details."
      );
    }
  }
}
