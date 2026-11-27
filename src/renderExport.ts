import { D2 } from "@d2lang/d2";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  CancellationToken,
  FileSystemError,
  FileType,
  TextDocument,
  Uri,
  workspace,
} from "vscode";
import { extContext, outputChannel } from "./extension";
import { resolveD2 } from "./bundledD2";
import { renderSource } from "./sdk";
import { previewOptions } from "./tasks";
import { renderFlags, runD2 } from "./runD2";

export async function renderExport(
  document: TextDocument,
  destination: Uri,
  format: string,
  token: CancellationToken
): Promise<void> {
  const config = workspace.getConfiguration("D2", document.uri);
  const options = previewOptions(document.uri);
  const cwd = document.isUntitled
    ? (workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
      workspace.workspaceFolders?.[0]?.uri.fsPath)
    : path.dirname(document.uri.fsPath);
  const source = document.getText();
  const dir = await mkdtemp(path.join(tmpdir(), "d2-export-"));
  const output = path.join(dir, "diagram." + format);
  const cancellation = new AbortController();
  let compiler: D2 | undefined;
  const listener = token.onCancellationRequested(() => {
    cancellation.abort();
    compiler?.dispose();
  });
  try {
    if (token.isCancellationRequested) {
      return;
    }
    if (format === "txt" || format === "svg") {
      const entry = document.isUntitled
        ? cwd && path.join(cwd, "untitled.d2")
        : document.uri.fsPath;
      compiler = new D2();
      const result = await renderSource(
        source,
        entry,
        options,
        format,
        compiler,
        cancellation.signal
      );
      await writeFile(output, result);
    } else {
      const args = renderFlags(options);
      if (format !== "gif") {
        args.push("--animate-interval=0");
      }
      if (format === "png") {
        args.push("--target=");
      }
      const executable = resolveD2(
        config.get<string>("execPath"),
        extContext.extensionPath
      );
      await runD2(executable, [...args, "-", output], cwd, source, cancellation.signal);
    }
    if (token.isCancellationRequested) {
      return;
    }
    // Copy alongside the destination before replacing it: a failed or cancelled
    // transfer must leave an existing export intact, including on remote providers.
    const staged = Uri.joinPath(destination, "..", ".d2-export-" + randomUUID());
    try {
      await workspace.fs.copy(Uri.file(output), staged);
      const existing = await workspace.fs.stat(destination).then(undefined, (err) => {
        if (!(err instanceof FileSystemError && err.code === "FileNotFound")) {
          throw err;
        }
        return undefined;
      });
      // VS Code marks a symlink to a directory with both FileType flags.
      // eslint-disable-next-line no-bitwise
      if (existing && (existing.type & FileType.Directory) !== 0) {
        throw new Error("The export destination is a directory: " + destination.fsPath);
      }
      if (token.isCancellationRequested) {
        return;
      }
      await workspace.fs.rename(staged, destination, { overwrite: true });
      outputChannel.appendInfo("Exported D2 diagram to " + destination.fsPath);
    } finally {
      await workspace.fs.delete(staged).then(undefined, () => undefined);
    }
  } finally {
    listener.dispose();
    await compiler?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}
