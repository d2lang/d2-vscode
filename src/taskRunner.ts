import * as path from "path";

import {
  CustomExecution,
  Event,
  EventEmitter,
  Pseudoterminal,
  Task,
  TaskPanelKind,
  TaskRevealKind,
  tasks,
  TextDocument,
  workspace,
  TaskScope,
} from "vscode";
import { d2TaskName, outputChannel } from "./extension";
import { previewOptions } from "./tasks";
import { renderSource } from "./sdk";

// eslint-disable-next-line no-unused-vars
export type TaskRunnerCallback = (data: string, error: string) => void;

/**
 * TaskRunner - This creates CustomTask and Pseudotermial to run it in.
 * This will return immediately, the tasks callback should be called
 * when the task is finished.
 */
export class TaskRunner {
  public genTask(document: TextDocument, callback: TaskRunnerCallback): void {
    const pty = new CustomTaskTerminal(document, document.getText(), callback);
    const ce = new CustomExecution(
      (): Promise<CustomTaskTerminal> =>
        new Promise((resolve) => {
          resolve(pty);
        })
    );

    const task = new Task(
      { type: "D2" },
      workspace.workspaceFolders?.length ? TaskScope.Workspace : TaskScope.Global,
      d2TaskName,
      "D2 Extension",
      ce,
      ["$D2Matcher"]
    );

    task.presentationOptions = {
      echo: true,
      reveal: TaskRevealKind.Silent,
      focus: false,
      clear: false,
      panel: TaskPanelKind.Dedicated,
      showReuseMessage: false,
    };
    tasks.executeTask(task);
  }
}

/**
 * CustomTaskTerminal - Implimentation of a Pseudoterminal that
 * allows for output to the Pseudoterminal that can be scraped
 * with a problemMatcher to put links to jump to the errors in
 * the document.
 */
class CustomTaskTerminal implements Pseudoterminal {
  private writeEmitter = new EventEmitter<string>();
  private closeEmitter = new EventEmitter<number>();

  onDidWrite: Event<string> = this.writeEmitter.event;
  onDidClose?: Event<number> = this.closeEmitter.event;

  private readonly document: TextDocument;
  private readonly source: string;
  private readonly callback: TaskRunnerCallback;

  constructor(document: TextDocument, source: string, callback: TaskRunnerCallback) {
    this.document = document;
    this.source = source;
    this.callback = callback;
  }

  async open(): Promise<void> {
    const { uri } = this.document;
    const cwd =
      workspace.getWorkspaceFolder(uri)?.uri.fsPath ??
      workspace.workspaceFolders?.[0]?.uri.fsPath;
    const file = this.document.isUntitled
      ? cwd && path.join(cwd, "untitled.d2")
      : uri.fsPath;
    try {
      const data = await renderSource(
        this.source,
        workspace.isTrusted ? file : undefined,
        previewOptions(uri)
      );
      this.callback(data, "");
      this.closeEmitter.fire(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendError(message);
      for (const line of message.split("\n")) {
        const location = /^(.*):(\d+):(\d+): (.*)$/.exec(line);
        if (location && file) {
          const [, name, row, column, detail] = location;
          const absolute = path.resolve(path.parse(file).root, name);
          this.writeLine(`[${absolute}] err: ${row}:${column}: ${detail}`);
        } else {
          this.writeLine(line);
        }
      }
      this.callback("", message);
      this.closeEmitter.fire(1);
    }
  }

  close(): void {
    this.closeEmitter.fire(0);
  }

  private write(msg: string): void {
    this.writeEmitter.fire(msg);
  }

  private writeLine(msg: string): void {
    this.write(msg + "\r\n");
  }
}
