import * as path from "path";
import type * as VSCode from "vscode";
import type { D2OutputChannel } from "./outputChannel";
import type { renderExport } from "./renderExport";

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

export function registerExportCommands(
  api: typeof VSCode,
  context: VSCode.ExtensionContext,
  renderFile: typeof renderExport,
  log: Pick<D2OutputChannel, "appendError">
): void {
  const { Uri, window, workspace } = api;
  context.subscriptions.push(
    api.commands.registerCommand("D2.CompileToSvg", (uri) => exportDiagram(uri, true)),
    api.commands.registerCommand("D2.ExportDiagram", (uri) => exportDiagram(uri))
  );

  async function exportDiagram(uri?: VSCode.Uri, quickSvg = false): Promise<void> {
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
          location: api.ProgressLocation.Notification,
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
      log.appendError(message);
      window.showErrorMessage("D2 export failed: " + message);
    }
  }
}
