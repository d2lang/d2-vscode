import type * as MarkdownIt from "markdown-it";
import * as path from "path";
import { MessageChannel, receiveMessageOnPort, Worker } from "worker_threads";
import { Uri, window, workspace } from "vscode";
import { previewOptions } from "./tasks";

let renderer: Worker | undefined;

export function disposeMarkdownRenderer(): void {
  if (renderer) {
    renderer.terminate();
    renderer = undefined;
  }
}

function renderFence(source: string, uri?: Uri): string {
  // Markdown-it must return complete HTML synchronously, including for consumers
  // of markdown.api.render. Keep one warm worker, separate from the async editor preview.
  if (!renderer) {
    const worker = new Worker(path.join(__dirname, "markdownRenderer.js"));
    worker.on("error", () => {
      if (renderer === worker) {
        renderer = undefined;
      }
    });
    worker.unref();
    renderer = worker;
  }
  const { port1, port2 } = new MessageChannel();
  const ready = new Int32Array(new SharedArrayBuffer(4));
  try {
    renderer.postMessage(
      {
        source,
        filename:
          workspace.isTrusted &&
          (uri?.scheme === "file" || uri?.scheme === "vscode-remote")
            ? uri.fsPath
            : undefined,
        options: previewOptions(uri),
        ready,
        port: port2,
      },
      [port2]
    );
    if (Atomics.wait(ready, 0, 0, 15000) === "timed-out") {
      disposeMarkdownRenderer();
      throw new Error("Timed out rendering the D2 block.");
    }
    const result = receiveMessageOnPort(port1)?.message;
    if (typeof result?.svg !== "string") {
      throw new Error(result?.error ?? "D2 rendered no diagram.");
    }
    return result.svg;
  } finally {
    port1.close();
  }
}

export function renderMarkdownDiagram(md: MarkdownIt): MarkdownIt {
  const original = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token.info.trim().split(/\s+/)[0] !== "d2") {
      return original(tokens, index, options, env, self);
    }
    const uri = env?.currentDocument ?? window.activeTextEditor?.document.uri;
    try {
      return `<div${self.renderAttrs(token)}>${renderFence(token.content, uri)}</div>\n`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `<pre${self.renderAttrs(token)}>${md.utils.escapeHtml(message)}</pre>\n`;
    }
  };
  return md;
}
