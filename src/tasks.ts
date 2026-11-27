import { CompileOptions } from "@d2lang/d2";
import { Uri, workspace } from "vscode";
import { NameToThemeNumber } from "./themePicker";

export function previewOptions(uri?: Uri): CompileOptions {
  const config = workspace.getConfiguration("D2", uri);
  const layout = config.get("previewLayout", "diagram") as string;
  const theme = config.get("previewTheme", "diagram");
  const sketch = config.get<boolean | null>("previewSketch", null);
  return {
    layout:
      layout === "elk" || layout === "tala" || layout === "dagre" ? layout : undefined,
    themeID: theme === "diagram" ? undefined : NameToThemeNumber(theme),
    sketch: sketch ?? undefined,
  };
}
