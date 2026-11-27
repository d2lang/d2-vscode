import * as path from "path";

export function useBundledD2(configured: string | undefined): boolean {
  return !configured || configured === "d2";
}

// The default and the old default "d2" both use the copy in the extension.
// env only contains overrides, so it is safe to pass to MCP discovery.
export function resolveD2(
  configured: string | undefined,
  extensionPath: string
): { command: string; args: string[]; env: Record<string, string> } {
  if (configured && !useBundledD2(configured)) {
    return { command: configured, args: [], env: {} };
  }
  return {
    command: process.execPath,
    args: [
      path.join(extensionPath, "runtime", "d2.cjs"),
      "--ms-enable-electron-run-as-node",
    ],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
