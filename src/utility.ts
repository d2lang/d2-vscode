import * as path from "path";
import * as os from "os";
import { existsSync } from "fs";
import { outputChannel } from "./extension";
import { window } from "vscode";
import { spawnSync } from "child_process";

/**
 * Utility - Set of common utility functions
 */
class Utility {
  /**
   * isFileOnPath - returns true if given file is found
   *   on the system path, false if not.
   */
  isFileOnPath(file: string): boolean {
    const sysPath: string = process.env.PATH ?? "";
    for (const p of sysPath.split(path.delimiter)) {
      const filePath = path.join(p, file);
      if (existsSync(filePath)) {
        return true;
      }
    }

    return false;
  }

  private static strBreak =
    "************************************************************";

  /**
   * Checks to see if 'xdg-open' is on the path
   */
  isXdgOpenAvailable(): boolean {
    if (this.isFileOnPath("xdg-open")) {
      return true;
    }
    return false;
  }

  /**
   * For each platform, create a way to open a file with the filetypes
   * default application.
   *
   */
  openWithDefaultApp(file: string) {
    switch (os.platform()) {
      case "win32": {
        spawnSync("start", [file]);
        break;
      }
      case "darwin": {
        spawnSync("open", [file]);
        break;
      }
      case "linux": {
        if (this.isXdgOpenAvailable()) {
          spawnSync("xdg-open", [file]);
        } else {
          const errorMsg = "XDG-OPEN needs to be installed to launch embedded links.";

          outputChannel.appendError(Utility.strBreak);

          outputChannel.appendError(errorMsg);

          outputChannel.appendError(Utility.strBreak);

          // Popup some toast to alert to the error
          window.showErrorMessage(errorMsg);

          outputChannel.outputChannel.show();
        }
        break;
      }
    }
  }
}

export const util: Utility = new Utility();
