import { spawnSync } from "child_process";
import { ws } from "./extension";
import { TaskOutput } from "./taskRunner";
import { NameToThemeNumber } from "./themePicker";
import { util, VT } from "./utility";

/**
 * D2Tasks - static functions to be used in tasks.  Functions need
 * to be synchronous, and return their results in a callback.
 */
class D2Tasks {
  public compile(
    text: string,
    filePath?: string,
    log?: TaskOutput,
    terminal?: TaskOutput
  ): string {
    const layout = ws.get("previewLayout", "diagram");
    const theme = ws.get("previewTheme", "diagram");
    const sketch = ws.get<boolean | null>("previewSketch", null);
    const d2Path: string = ws.get("execPath", "d2");

    terminal?.(`${VT.Green}Starting Compile...${VT.Reset}`);
    terminal?.(
      `Layout: ${VT.Yellow}${layout}${VT.Reset}  Theme: ${VT.Yellow}${theme}${
        VT.Reset
      }  Sketch: ${VT.Yellow}${sketch ?? "diagram"}${VT.Reset}`
    );
    terminal?.(`Current Working Directory: ${VT.Yellow}${filePath}${VT.Reset}`);
    terminal?.("");

    const args: string[] = [];
    if (layout !== "diagram") {
      args.push(`--layout=${layout}`);
    }
    if (theme !== "diagram") {
      args.push(`--theme=${NameToThemeNumber(theme)}`);
    }
    if (sketch !== null) {
      args.push(`--sketch=${sketch}`);
    }
    args.push("-");

    // spawnSync doesn't like blank working directories
    if (filePath === "") {
      filePath = undefined;
    }

    const proc = spawnSync(d2Path, args, {
      cwd: filePath,
      input: text,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 24,
    });

    /** proc.status: 0 - success
     *  proc.status: 1 - errors
     *  proc.pid: 0 - EXE Not Found
     */
    if (proc.pid === 0) {
      util.showErrorToolsNotFound(proc.error?.message ?? "");
    } else {
      let error: string = proc.stderr?.toString() ?? "";
      // Get rid of superfluous info that means nothing to vscode users
      error = error.replace(" - to -", "");

      for (const msg of error.split("\n")) {
        if (msg.length === 0) {
          // Sometimes there is a blank line that we
          // don't have to worry about
          continue;
        }

        terminal?.(msg, true);
      }

      const spawnErr = proc.error?.message;
      if (spawnErr) {
        terminal?.(spawnErr, true);
      }
    }

    terminal?.("");

    let data = "";
    // Success! Read the output
    if (proc.status === 0) {
      data = proc.stdout.toString();
    }

    return data;
  }
}

export const d2Tasks: D2Tasks = new D2Tasks();
