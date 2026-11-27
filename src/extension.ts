/**
 * d2 File Viewer Extension
 **/

import * as vscode from "vscode";
import {
  commands,
  Disposable,
  ExtensionContext,
  languages,
  TextDocument,
  TextDocumentChangeEvent,
  TextDocumentSaveReason,
  TextDocumentWillSaveEvent,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";

import { DocToPreviewGenerator } from "./docToPreviewGenerator";
import { D2OutputChannel } from "./outputChannel";
import * as mdItContainer from "markdown-it-container";
import { layoutPicker } from "./layoutPicker";
import { themePicker } from "./themePicker";
import { TaskRunner } from "./taskRunner";
import { disposeCompiler } from "./sdk";
import { disposeMarkdownRenderer, renderMarkdownDiagram } from "./markdownPreview";
import { registerExportCommands } from "./exportDiagram";
import { renderExport } from "./renderExport";
import { formatD2Block, formatD2Document } from "./format";
import { D2LanguageServer } from "./languageServer";
import { registerD2Mcp } from "./mcpServer";

export const d2Ext = "d2";
export const d2Lang = "d2";
export const previewGenerator: DocToPreviewGenerator = new DocToPreviewGenerator();
export const d2ConfigSection = "D2";
export const d2TaskName = "D2 Task";
export let ws: WorkspaceConfiguration = workspace.getConfiguration(d2ConfigSection);
export const outputChannel: D2OutputChannel = new D2OutputChannel();
export const taskRunner: TaskRunner = new TaskRunner();
export let extContext: ExtensionContext;
let languageServer: D2LanguageServer | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VSCAny = any;

export function activate(context: ExtensionContext): VSCAny {
  extContext = context;
  registerD2Mcp(vscode, context);
  context.subscriptions.push(new Disposable(() => {
    disposeMarkdownRenderer();
    void disposeCompiler();
  }));

  let sdkFormatter: Disposable | undefined;
  function setNativeFormatting(active: boolean): void {
    if (active) {
      sdkFormatter?.dispose();
      sdkFormatter = undefined;
    } else if (languageServer && !sdkFormatter) {
      sdkFormatter = languages.registerDocumentFormattingEditProvider(d2Lang, {
        provideDocumentFormattingEdits: formatD2Document,
      });
    }
  }
  languageServer = new D2LanguageServer(
    outputChannel.outputChannel,
    setNativeFormatting,
    context.extensionPath
  );
  setNativeFormatting(false);
  context.subscriptions.push(new Disposable(() => sdkFormatter?.dispose()));

  function startLanguageServer(): void {
    languageServer?.start(ws.get("execPath", ""));
  }

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      const wsOld = ws;
      ws = workspace.getConfiguration(d2ConfigSection);
      if (
        event.affectsConfiguration("D2.execPath") &&
        workspace.textDocuments.some((doc) => doc.languageId === d2Lang)
      ) {
        startLanguageServer();
      }

      if (
        ws.get("previewLayout") !== wsOld.get("previewLayout") ||
        ws.get("previewTheme") !== wsOld.get("previewTheme") ||
        ws.get("previewSketch") !== wsOld.get("previewSketch")
      ) {
        const activeEditor = window.activeTextEditor;
        if (activeEditor?.document.languageId === d2Ext) {
          previewGenerator.generate(activeEditor.document);
        }
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidChangeTextDocument((e: TextDocumentChangeEvent) => {
      if (e.document.languageId === d2Ext && e.contentChanges.length > 0) {
        const autoUp = ws.get("autoUpdate", false);

        if (autoUp) {
          const trk = previewGenerator.getTrackObject(e.document);
          trk?.timer?.reset();
        }
      }
    })
  );

  // User actually forced a save, NOT auto save
  let hardSave = false;

  context.subscriptions.push(
    workspace.onWillSaveTextDocument((e: TextDocumentWillSaveEvent) => {
      if (e.document.languageId === d2Ext) {
        hardSave = e.reason === TextDocumentSaveReason.Manual;
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidSaveTextDocument((doc: TextDocument) => {
      if (doc.languageId === d2Ext) {
        const updateOnSave = ws.get("updateOnSave", false);

        const trk = previewGenerator.getTrackObject(doc);

        // If we don't have preview window open, then no need to update it
        if (updateOnSave && hardSave && trk?.outputDoc) {
          previewGenerator.generate(doc);
        }

        hardSave = false;
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidOpenTextDocument((doc: TextDocument) => {
      if (doc.languageId === d2Ext) {
        previewGenerator.createObjectToTrack(doc);
        startLanguageServer();
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidCloseTextDocument((doc: TextDocument) => {
      if (doc.languageId === d2Ext) {
        previewGenerator.deleteObjectToTrack(doc);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("D2.ShowPreviewWindow", () => {
      const activeEditor = window.activeTextEditor;

      if (activeEditor?.document.languageId === d2Ext) {
        previewGenerator.generate(activeEditor.document);

        const trk = previewGenerator.getTrackObject(activeEditor.document);
        trk?.outputDoc?.show();
      }
    })
  );

  registerExportCommands(vscode, context, renderExport, outputChannel);

  context.subscriptions.push(commands.registerCommand("D2.FormatD2Block", formatD2Block));

  context.subscriptions.push(
    commands.registerCommand("D2.PickLayout", () => {
      const activeEditor = window.activeTextEditor;

      if (activeEditor?.document.languageId === d2Ext) {
        const layoutPick = new layoutPicker();
        layoutPick.showPicker().then((layout) => {
          if (layout) {
            ws.update("previewLayout", layout.label, true);
          }
        });
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("D2.PickTheme", () => {
      const activeEditor = window.activeTextEditor;

      if (activeEditor?.document.languageId === d2Ext) {
        const themePick = new themePicker();
        themePick.showPicker().then((theme) => {
          if (theme) {
            ws.update("previewTheme", theme.label, true);
          }
        });
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("D2.ToggleSketch", () => {
      const activeEditor = window.activeTextEditor;

      if (activeEditor?.document.languageId === d2Ext) {
        const current: boolean = ws.get("previewSketch", false);
        ws.update("previewSketch", !current, true);
      }
    })
  );

  /** Find all open d2 files and add to tracker if they are
   *  open before the extension loads
   */
  workspace.textDocuments.forEach((td: TextDocument) => {
    if (td.languageId === d2Ext) {
      previewGenerator.createObjectToTrack(td);
      startLanguageServer();
    }
  });

  // Return our markdown renderer
  return {
    // Sets up our ability to render for markdown files
    extendMarkdownIt(md: VSCAny) {
      extendMarkdownItWithD2(md);
      return md;
    },
  };
}

export function deactivate(): Promise<void> | undefined {
  const server = languageServer;
  languageServer = undefined;
  return server?.stop();
}

const pluginKeyword = "d2";

/**
 *
 * This function will be asked by the Markdown system to render
 * a D2 snippet in a markdown file
 */
export function extendMarkdownItWithD2(md: VSCAny): unknown {
  md.use(mdItContainer, pluginKeyword, {});

  return renderMarkdownDiagram(md);
}
