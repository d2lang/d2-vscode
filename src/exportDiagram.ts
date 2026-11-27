import { execFile } from "child_process";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  CancellationToken,
  FileSystemError,
  FileType,
  ProgressLocation,
  TextDocument,
  Uri,
  window,
  workspace,
} from "vscode";
import { outputChannel } from "./extension";
import { renderFlags } from "./tasks";

const formats = [
  { label: "SVG", description: "Vector image", extension: "svg" },
  { label: "PNG", description: "Raster image of the root board", extension: "png" },
  { label: "PDF", description: "Document, one page per board", extension: "pdf" },
  {
    label: "PowerPoint",
    description: "Presentation, one slide per board",
    extension: "pptx",
  },
  { label: "GIF", description: "Animated diagram", extension: "gif" },
  { label: "Text", description: "Text diagram of the root board", extension: "txt" },
];

function runRenderer(
  executable: string,
  args: string[],
  cwd: string | undefined,
  source: string,
  token: CancellationToken
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { cwd, windowsHide: true },
      (error, _stdout, stderr) => {
        cancellation.dispose();
        if (error) {
          reject(new Error(stderr.trim() || error.message));
        } else {
          resolve();
        }
      }
    );
    const cancellation = token.onCancellationRequested(() => child.kill());
    // A missing executable or a cancelled render can close stdin before it is read.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(source);
  });
}

async function renderFile(
  document: TextDocument,
  destination: Uri,
  format: string,
  token: CancellationToken
): Promise<void> {
  const config = workspace.getConfiguration("D2", document.uri);
  const args = renderFlags(
    config.get("previewLayout", "diagram"),
    config.get("previewTheme", "diagram"),
    config.get<boolean | null>("previewSketch", null)
  );
  // D2 rejects static output when the source sets a positive animation interval.
  if (format !== "svg" && format !== "gif") {
    args.push("--animate-interval=0");
  }
  if (format === "png" || format === "txt") {
    args.push("--target=");
  }
  const cwd = document.isUntitled
    ? workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
      workspace.workspaceFolders?.[0]?.uri.fsPath
    : path.dirname(document.uri.fsPath);
  const source = document.getText();
  const dir = await mkdtemp(path.join(tmpdir(), "d2-export-"));
  const output = path.join(dir, "diagram." + format);
  try {
    if (token.isCancellationRequested) {
      return;
    }
    await runRenderer(
      config.get("execPath", "d2"),
      [...args, "-", output],
      cwd,
      source,
      token
    );
    // The CLI normally emits one file per board for a non-animated multiboard SVG.
    if (
      format === "svg" &&
      (await stat(path.join(dir, "diagram")).catch(() => undefined))?.isDirectory()
    ) {
      throw new Error(
        "This diagram has multiple boards. Choose PDF, PowerPoint, or GIF to export all boards in one file, or set vars.d2-config.animate-interval for an animated SVG."
      );
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
    await rm(dir, { recursive: true, force: true });
  }
}

export async function exportDiagram(uri?: Uri, quickSvg = false): Promise<void> {
  try {
    const document = uri
      ? await workspace.openTextDocument(uri)
      : window.activeTextEditor?.document;
    if (document?.languageId !== "d2" || !workspace.isTrusted) {
      return;
    }

    const format = quickSvg
      ? formats[0]
      : await window.showQuickPick(formats, {
          title: "Export D2 diagram",
          placeHolder: "Choose an output format",
        });
    if (!format) {
      return;
    }
    const base = path.parse(document.fileName).name;
    const folder = document.isUntitled
      ? workspace.workspaceFolders?.[0]?.uri
      : Uri.joinPath(document.uri, "..");
    const defaultUri = folder && Uri.joinPath(folder, base + "." + format.extension);
    const destination =
      quickSvg && !document.isUntitled
        ? defaultUri
        : await window.showSaveDialog({
            title: "Export D2 diagram",
            saveLabel: "Export",
            defaultUri,
            filters: { [format.label]: [format.extension] },
          });
    if (!destination) {
      return;
    }
    if (
      path.extname(destination.path).toLowerCase() !== "." + format.extension ||
      destination.toString().toLowerCase() === document.uri.toString().toLowerCase()
    ) {
      throw new Error(
        "Choose a separate ." + format.extension + " file for this export."
      );
    }
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Exporting D2 diagram to " + format.label,
        cancellable: true,
      },
      async (_, token) => {
        try {
          await renderFile(document, destination, format.extension, token);
        } catch (error) {
          if (!token.isCancellationRequested) {
            throw error;
          }
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendError(message);
    window.showErrorMessage("D2 export failed: " + message);
  }
}
