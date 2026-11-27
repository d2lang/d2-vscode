const assert = require("node:assert/strict");
const { posix } = require("node:path");
const { test } = require("node:test");
const { registerExportCommands } = require("../node_modules/.cache/d2-test/exportDiagram");

function uri(path) {
  return { path, toString: () => "file://" + path };
}

test("Export Diagram As renders the chosen format to the chosen destination", async () => {
  const source = uri("/diagrams/diagram with spaces.d2");
  const destination = uri("/exports/result.png");
  const document = { languageId: "d2", fileName: source.path, uri: source };
  const token = { isCancellationRequested: false };
  const handlers = new Map();
  const renders = [];
  let pickCount = 0;
  let saveCount = 0;
  let cancelAt;
  const api = {
    Uri: { joinPath: (base, ...parts) => uri(posix.join(base.path, ...parts)) },
    ProgressLocation: { Notification: 15 },
    commands: { registerCommand: (id, fn) => handlers.set(id, fn) },
    workspace: {
      isTrusted: true,
      openTextDocument: async (input) => {
        assert.equal(input, source);
        return document;
      },
    },
    window: {
      showQuickPick: async (formats) => {
        pickCount++;
        assert.deepEqual(formats.map(({ extension }) => extension), [
          "svg", "png", "pdf", "pptx", "gif", "txt",
        ]);
        if (cancelAt !== "picker") return formats.find(({ label }) => label === "PNG");
      },
      showSaveDialog: async (options) => {
        saveCount++;
        assert.equal(options.defaultUri.path, "/diagrams/diagram with spaces.png");
        assert.deepEqual(options.filters, { PNG: ["png"] });
        if (cancelAt !== "save") return destination;
      },
      withProgress: (_options, render) => render({}, token),
      showErrorMessage: assert.fail,
    },
  };
  registerExportCommands(
    api, { subscriptions: [] }, (...args) => renders.push(args), { appendError: assert.fail },
  );
  const run = () => handlers.get("D2.ExportDiagram")(source);
  await run();
  assert.deepEqual(renders, [[document, destination, "png", token]]);
  cancelAt = "picker";
  await run();
  cancelAt = "save";
  await run();
  api.workspace.isTrusted = false;
  await run();
  assert.equal(pickCount, 3);
  assert.equal(saveCount, 2);
  assert.equal(renders.length, 1);
});
