import { QuickPickItem, window } from "vscode";

const layouts: QuickPickItem[] = [
  { label: "diagram", description: "Use the diagram’s layout setting" },
  { label: "dagre", description: "The directed graph layout library Dagre" },
  { label: "elk", description: "Eclipse Layout Kernel with the Layered algorithm" },
  { label: "tala", description: "TALA layout" },
];

export class layoutPicker {
  showPicker(): Thenable<QuickPickItem | undefined> {
    return window.showQuickPick(layouts, {
      title: "Layouts",
      canPickMany: false,
      placeHolder: "Choose a layout...",
    });
  }
}
