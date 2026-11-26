import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { OutputChannel } from "vscode";
import { formatD2Document } from "./format";
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  RevealOutputChannelOn,
  State,
} from "vscode-languageclient/node";

const exec = promisify(execFile);
const startupTimeout = 10000;

// eslint-disable-next-line no-unused-vars -- TypeScript callback parameter
type SetNativeFormatting = (active: boolean) => void;

// Client 8 calls stop() after an initialize error, including when there is no
// running connection to shut down. The owner reaps the process in that case.
class D2Client extends LanguageClient {
  override error(message: string, data?: unknown, notify?: boolean | "force"): void {
    // Client 8 forces a generic error popup after a failed or canceled start.
    // Startup failures are already logged in D2-Output; the CLI formatter stays available.
    super.error(message, data, this.state === State.Stopped ? false : notify);
  }

  override stop(timeout?: number): Promise<void> {
    return this.state === State.Starting ? Promise.resolve() : super.stop(timeout);
  }

  protected override async handleConnectionClosed(): Promise<void> {
    if (this.state === State.Starting) {
      // Keep observing the in-flight start promise: v8 clears its own reference
      // to that promise when the transport closes during the handshake.
      const starting = this.start();
      await Promise.allSettled([starting, super.handleConnectionClosed()]);
    } else {
      await super.handleConnectionClosed();
    }
  }
}

export class D2LanguageServer {
  private readonly output: OutputChannel;
  private readonly setNativeFormatting: SetNativeFormatting;
  private executable?: string;
  private pending = Promise.resolve();
  private stopClient?: () => Promise<void>;
  private startup?: AbortController;
  private generation = 0;

  constructor(output: OutputChannel, setNativeFormatting: SetNativeFormatting) {
    this.output = output;
    this.setNativeFormatting = setNativeFormatting;
  }

  start(executable: string): void {
    if (executable !== this.executable) {
      this.changeExecutable(executable);
    }
  }

  stop(): Promise<void> {
    this.changeExecutable(undefined);
    return this.pending;
  }

  private changeExecutable(executable: string | undefined): void {
    this.executable = executable;
    const generation = ++this.generation;
    this.startup?.abort();
    this.pending = this.pending
      .then(async () => {
        // Several settings changes can arrive while a previous server is stopping.
        if (this.generation !== generation) {
          return;
        }
        await this.stopClient?.();
        this.stopClient = undefined;
        if (executable === undefined || this.generation !== generation) {
          return;
        }
        const startup = new AbortController();
        this.startup = startup;
        const timeout = setTimeout(() => startup.abort(), startupTimeout);
        try {
          await this.startClient(executable, startup.signal);
        } finally {
          clearTimeout(timeout);
          this.startup = undefined;
        }
      })
      .catch((error) => {
        if (this.generation === generation) {
          this.output.appendLine(`D2 language server (${executable}): ${error}`);
        }
      });
  }

  private async startClient(executable: string, signal: AbortSignal): Promise<void> {
    // Old releases also exit successfully on "d2 lsp --help" with the general help.
    // Check the CLI's advertised commands so locally built binaries work as well.
    const { stdout } = await exec(executable, ["--help"], {
      signal,
      killSignal: "SIGKILL",
    });
    if (signal.aborted) {
      return;
    }
    if (!/^\s*\S.* lsp(?: \[--stdio\])?[ \t]*$/m.test(stdout)) {
      this.output.appendLine(`${executable} has no lsp command. Using d2 fmt.`);
      return;
    }

    const child = spawn(executable, ["lsp", "--stdio"], {
      signal,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const client = new D2Client(
      "d2",
      "D2 Language Server",
      () => Promise.resolve(child),
      {
        documentSelector: [{ language: "d2" }],
        outputChannel: this.output,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        middleware: {
          async provideDocumentFormattingEdits(document, options, token, provideEdits) {
            const version = document.version;
            const edits = await provideEdits(document, options, token);
            if (
              token.isCancellationRequested ||
              document.isClosed ||
              document.version !== version
            ) {
              return [];
            }
            // d2 lsp returns null above 2 MiB, which the client converts to undefined.
            if (
              edits === undefined &&
              Buffer.byteLength(document.getText(), "utf8") > 2 * 1024 * 1024
            ) {
              return formatD2Document(document, options, token);
            }
            return edits;
          },
        },
        initializationFailedHandler: () => false,
        errorHandler: {
          error: () => ({ action: ErrorAction.Shutdown, handled: true }),
          closed: () => ({ action: CloseAction.DoNotRestart, handled: true }),
        },
      }
    );
    const state = client.onDidChangeState(({ newState }) => {
      if (newState === State.Stopped) {
        this.setNativeFormatting(false);
        child.kill("SIGKILL");
      }
    });
    this.stopClient = async () => {
      state.dispose();
      this.setNativeFormatting(false);
      try {
        if (client.isRunning()) {
          await client.stop();
        }
      } catch (error) {
        this.output.appendLine(`Could not stop D2 language server: ${error}`);
      } finally {
        // The protocol shutdown can time out, or a faulty server can ignore exit.
        child.stdin.end();
        setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      }
    };

    try {
      await client.start();
      if (client.isRunning() && !signal.aborted) {
        this.setNativeFormatting(
          Boolean(client.initializeResult?.capabilities.documentFormattingProvider)
        );
      }
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
  }
}
