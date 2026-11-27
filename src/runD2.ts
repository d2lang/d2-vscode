import { execFile } from "child_process";
import { resolveD2 } from "./bundledD2";
import type { CompileOptions } from "@d2lang/d2";

export function renderFlags(options: CompileOptions): string[] {
  const args: string[] = [];
  if (options.layout !== undefined) {
    args.push(`--layout=${options.layout}`);
  }
  if (options.themeID !== undefined) {
    args.push(`--theme=${options.themeID}`);
  }
  if (options.sketch !== undefined) {
    args.push(`--sketch=${options.sketch}`);
  }
  return args;
}

export function runD2(
  executable: ReturnType<typeof resolveD2>,
  args: string[],
  cwd: string | undefined,
  source: string,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable.command,
      [...executable.args, ...args],
      {
        cwd,
        env: { ...process.env, ...executable.env },
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 24 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
        } else {
          resolve(stdout);
        }
      }
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(source);
  });
}
