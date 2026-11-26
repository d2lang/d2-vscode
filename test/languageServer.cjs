const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");
const vscode = require("vscode");

const { commands, languages, Position, Range, Uri, window, workspace, WorkspaceEdit } =
  vscode;

async function eventually(description, check) {
  const deadline = Date.now() + 15000;
  do {
    if (await check()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}`);
}

async function openFile(name, source) {
  const uri = Uri.joinPath(workspace.workspaceFolders[0].uri, name);
  await workspace.fs.writeFile(uri, Buffer.from(source));
  return workspace.openTextDocument(uri);
}

async function replaceBuffer(document, source) {
  const edit = new WorkspaceEdit();
  edit.replace(
    document.uri,
    new Range(new Position(0, 0), document.positionAt(document.getText().length)),
    source,
  );
  assert(await workspace.applyEdit(edit));
}

async function checkFormat(document) {
  const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  await replaceBuffer(document, "api->db\n");
  const edits = await commands.executeCommand(
    "vscode.executeFormatDocumentProvider",
    document.uri,
    {
      tabSize: 2,
      insertSpaces: true,
    },
  );
  assert(edits?.length, "Format Document must return edits");
  const change = new WorkspaceEdit();
  change.set(document.uri, edits);
  assert(await workspace.applyEdit(change));
  assert.equal(document.getText(), "api -> db" + newline);
}

exports.run = async () => {
  const library = await openFile("library.d2", "on_disk\n");
  const main = await openFile(
    "diagram.d2",
    "...@library\napi -> db\nnote: {near: api}\n",
  );
  const attrs = await openFile("attributes.d2", "x.shape: circle\nx.style.fill: red\n");
  await window.showTextDocument(main);
  const symbols = () =>
    commands.executeCommand("vscode.executeDocumentSymbolProvider", attrs.uri);
  await eventually("native document symbols", async () => (await symbols())?.length);
  assert.deepEqual(
    (await symbols()).map((symbol) => symbol.name),
    ["x"],
  );
  const untitled = await workspace.openTextDocument({ language: "d2", content: "draft" });
  const draftSymbols = await commands.executeCommand(
    "vscode.executeDocumentSymbolProvider",
    untitled.uri,
  );
  assert.deepEqual(
    draftSymbols.map((symbol) => symbol.name),
    ["draft"],
  );

  const target = new Position(1, 1);
  // Immediately navigate across files after an unsaved edit moves the target.
  await replaceBuffer(library, "# unsaved\napi: API\n");
  const definitions = await commands.executeCommand(
    "vscode.executeDefinitionProvider",
    main.uri,
    target,
  );
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri.toString(), library.uri.toString());
  assert.equal(definitions[0].range.start.line, 1);
  const refs = await commands.executeCommand(
    "vscode.executeReferenceProvider",
    main.uri,
    target,
  );
  assert(
    refs.some(
      (ref) => ref.uri.toString() === main.uri.toString() && ref.range.start.line === 2,
    ),
  );
  const rename = await commands.executeCommand(
    "vscode.executeDocumentRenameProvider",
    main.uri,
    target,
    "service",
  );
  assert(await workspace.applyEdit(rename));
  assert.equal(library.getText(), "# unsaved\nservice: API\n");
  assert.equal(main.getText(), "...@library\nservice -> db\nnote: {near: service}\n");

  const hover = await commands.executeCommand(
    "vscode.executeHoverProvider",
    attrs.uri,
    new Position(0, 3),
  );
  assert(hover.some((item) => item.contents.length));
  await replaceBuffer(attrs, "x.shape:");
  const completion = await commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    attrs.uri,
    new Position(0, 8),
  );
  assert(
    completion.items.some(
      (item) => item.label === "circle" || item.label.label === "circle",
    ),
  );

  const d2Errors = () =>
    languages.getDiagnostics(attrs.uri).filter((item) => item.source === "d2");
  await replaceBuffer(attrs, "x: {\n");
  await eventually("D2 syntax diagnostic", () => d2Errors().length);
  await checkFormat(attrs);
  await eventually("cleared D2 diagnostics", () => d2Errors().length === 0);
  const windowsFile = await openFile("windows.d2", "x\r\n");
  await checkFormat(windowsFile);

  // A single window exercises provider teardown, CLI fallback, and attaching already-open buffers again.
  const config = workspace.getConfiguration("D2");
  await config.update(
    "execPath",
    process.env.D2_LEGACY_BIN,
    vscode.ConfigurationTarget.Global,
  );
  await eventually("native providers to stop", async () => !(await symbols())?.length);
  await checkFormat(attrs);
  const markdown = await openFile("guide.md", "# Diagram\n\n```d2\napi->db\n```\n");
  const editor = await window.showTextDocument(markdown);
  editor.selection = new vscode.Selection(3, 0, 3, 0);
  await commands.executeCommand("D2.FormatD2Block");
  assert.equal(markdown.getText(), "# Diagram\n\n```d2\napi -> db\n```\n");

  await config.update(
    "execPath",
    process.env.D2_LSP_BIN,
    vscode.ConfigurationTarget.Global,
  );
  await eventually("native providers to restart", async () => (await symbols())?.length);
  console.log(
    "D2 native features, CLI fallback, Markdown formatting and configuration restart passed.",
  );
};
