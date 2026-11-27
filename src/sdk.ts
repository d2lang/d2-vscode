import { D2, CompileOptions, CompileResponse } from "@d2lang/d2";
import { readFile } from "fs/promises";
import { resolveD2 } from "./bundledD2";
import { renderFlags, runD2 } from "./runD2";
import * as path from "path";

let compiler: D2 | undefined;

export function getCompiler(): D2 {
  return (compiler ??= new D2());
}

export async function disposeCompiler(): Promise<void> {
  const previous = compiler;
  compiler = undefined;
  await previous?.dispose();
}

function diagnostics(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }
  try {
    const entries = JSON.parse(error.message);
    if (
      Array.isArray(entries) &&
      entries.length &&
      entries.every((e) => typeof e?.errmsg === "string")
    ) {
      return entries.map((entry) => entry.errmsg);
    }
  } catch {
    // Worker and filesystem failures are already plain text.
  }
  return [error.message];
}

export async function renderSource(
  source: string,
  filename: string | undefined,
  options: CompileOptions,
  format: "preview" | "svg" | "txt" = "preview",
  sdk = getCompiler(),
  signal?: AbortSignal
): Promise<string> {
  const absolute = filename && path.resolve(filename);
  const root = absolute ? path.parse(absolute).root : undefined;
  const inputPath =
    absolute && root
      ? path.relative(root, absolute).split(path.sep).join("/")
      : "diagram.d2";
  const files: Record<string, string> = Object.assign(Object.create(null), {
    [inputPath]: source,
  });
  let result: CompileResponse;
  for (;;) {
    try {
      // Each compile can reveal imports from the files discovered in the last pass.
      // eslint-disable-next-line no-await-in-loop
      result = await sdk.compile({ fs: files, inputPath }, options);
      break;
    } catch (error) {
      const messages = diagnostics(error);
      const missing = new Set<string>();
      for (const message of messages) {
        const match = /: failed to import ("(?:[^"\\]|\\.)+"): file does not exist$/.exec(
          message
        );
        if (match && root) {
          const file: string = JSON.parse(match[1]);
          if (
            file.endsWith(".d2") &&
            !path.isAbsolute(file) &&
            !file.split("/").includes("..") &&
            !Object.prototype.hasOwnProperty.call(files, file)
          ) {
            missing.add(file);
          }
        }
      }
      if (!root || !missing.size) {
        throw new Error(messages.join("\n"));
      }
      // The compiler resolves imports, including nested imports and field selectors.
      // Read only files it requests, preserving the unsaved entry in the virtual FS.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        Array.from(missing, async (file) => {
          files[file] = await readFile(path.join(root, file), "utf8");
        })
      );
    }
  }
  const { diagram, renderOptions } = result;
  if (format === "txt") {
    return sdk.render(diagram, { ...renderOptions, animateInterval: 0, ascii: true });
  }
  const animated = (renderOptions.animateInterval ?? 0) > 0;
  if (
    format === "svg" &&
    !animated &&
    [diagram.layers, diagram.scenarios, diagram.steps].some((boards) => boards?.length)
  ) {
    throw new Error(
      "This diagram has multiple boards. Choose PDF, PowerPoint, or GIF to export all boards in one file, or set vars.d2-config.animate-interval for an animated SVG."
    );
  }
  const svg = await sdk.render(
    diagram,
    animated ? { ...renderOptions, target: "*" } : renderOptions
  );
  // D2.js emits image URLs. The D2 distribution also includes its asset bundler,
  // which embeds these into the standalone SVG with D2's usual filesystem and URL policy.
  if (/<image\b[^>]*\bhref="(?!data:)[^"]+"/i.test(svg)) {
    const args = [...renderFlags(options), "--bundle"];
    if (!filename) {
      args.push("--allow-local-files=false");
    }
    if (!animated) {
      args.push("--target=");
    }
    return runD2(
      resolveD2(undefined, path.resolve(__dirname, "..")),
      [...args, "-", "-"],
      filename && path.dirname(filename),
      source,
      signal
    );
  }
  return svg;
}
