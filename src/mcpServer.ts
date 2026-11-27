import { ChildProcess, execFile } from "child_process";
import type * as VSCode from "vscode";
import { resolveD2, useBundledD2 } from "./bundledD2";

export function registerD2Mcp(
  api: typeof VSCode,
  context: VSCode.ExtensionContext
): void {
  // VS Code 1.100 exposes the method but throws unless an extension opts into
  // its proposed API. It became public in 1.101.
  const [major, minor] = api.version.split(".").map(Number);
  if (
    major < 1 ||
    (major === 1 && minor < 101) ||
    !api.lm?.registerMcpServerDefinitionProvider
  ) {
    return;
  }
  const { workspace } = api;
  const changed = new api.EventEmitter<void>();
  let servers: VSCode.McpStdioServerDefinition[] = [];
  let probe: ChildProcess | undefined;

  function refresh(): void {
    probe?.kill("SIGKILL");
    probe = undefined;
    if (servers.length) {
      servers = [];
      changed.fire();
    }
    if (!workspace.isTrusted) {
      return;
    }
    const executable = workspace.getConfiguration("D2").get("execPath", "");
    if (typeof executable !== "string" || executable.includes("\0")) {
      return;
    }
    if (useBundledD2(executable)) {
      const { command, args, env } = resolveD2(executable, context.extensionPath);
      servers = [new api.McpStdioServerDefinition("D2", command, [...args, "mcp"], env)];
      changed.fire();
      return;
    }
    const child = execFile(
      executable,
      ["mcp", "--help"],
      { timeout: 5000, killSignal: "SIGKILL", windowsHide: true },
      (error, stdout) => {
        if (probe !== child) {
          return;
        }
        probe = undefined;
        // Older D2 releases exit successfully and print the generic CLI help.
        if (error || !/^Usage:\r?\n[ \t]+.+ mcp(?:[ \t]|\r?$)/m.test(stdout)) {
          return;
        }
        servers = [new api.McpStdioServerDefinition("D2", executable, ["mcp"])];
        changed.fire();
      }
    );
    probe = child;
  }

  context.subscriptions.push(
    changed,
    api.lm.registerMcpServerDefinitionProvider("d2.mcp", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => servers,
    }),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("D2.execPath")) {
        refresh();
      }
    }),
    workspace.onDidGrantWorkspaceTrust(refresh),
    new api.Disposable(() => {
      probe?.kill("SIGKILL");
      probe = undefined;
    })
  );
  refresh();
}
