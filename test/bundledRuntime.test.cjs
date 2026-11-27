const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { test } = require("node:test");
const { pathToFileURL, fileURLToPath } = require("node:url");
const rpc = require("vscode-jsonrpc/node");

function start(t, args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "D2 protocol "));
  const launcher = path.resolve(__dirname, "../runtime/d2.cjs");
  const proc = spawn(process.execPath, [launcher, "--ms-enable-electron-run-as-node", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const closed = new Promise((resolve) => proc.once("close", resolve));
  t.after(async () => {
    proc.kill("SIGKILL");
    await closed;
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return { proc, cwd };
}

test("the bundled language server resolves a disk import and publishes idle diagnostics", {
  timeout: 30_000,
}, async (t) => {
  const { cwd, proc } = start(t, ["lsp", "--stdio"]);
  const connection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(proc.stdout),
    new rpc.StreamMessageWriter(proc.stdin),
  );
  t.after(() => connection.dispose());
  connection.listen();
  const init = await connection.sendRequest("initialize", { processId: null, capabilities: {} });
  assert.equal(init.capabilities.definitionProvider, true);
  await connection.sendNotification("initialized", {});

  const library = path.join(cwd, "library.d2");
  fs.writeFileSync(library, "# imported from disk\nservice: Service");
  const uri = pathToFileURL(path.join(cwd, "main.d2")).href;
  await connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "d2", version: 1, text: "...@library\nservice -> client" },
  });
  const definition = await connection.sendRequest("textDocument/definition", {
    textDocument: { uri },
    position: { line: 1, character: 1 },
  });
  assert.ok(definition, "the bundled server resolves imports through the host filesystem");
  assert.equal(fs.realpathSync(fileURLToPath(definition.uri)), fs.realpathSync(library));
  assert.deepEqual(definition.range.start, { line: 1, character: 0 });

  const diagnostics = new Promise((resolve) => {
    connection.onNotification("textDocument/publishDiagnostics", (event) => {
      if (event.uri === uri && event.version === 2) resolve(event.diagnostics);
    });
  });
  await connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 }, contentChanges: [{ text: "a: {" }],
  });
  assert.match((await diagnostics)[0].message, /maps must be terminated/);
  await connection.sendRequest("shutdown");
  await connection.sendNotification("exit");
});

test("the bundled MCP server lists tools and renders PNG with an empty PATH", {
  timeout: 30_000,
}, async (t) => {
  const { proc } = start(t, ["mcp"]);
  const lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  let id = 0;
  async function request(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
    const { value, done } = await lines.next();
    assert.equal(done, false, "the MCP process returned a response");
    const response = JSON.parse(value);
    assert.equal(response.id, id);
    assert.equal(response.error, undefined);
    return response.result;
  }
  const init = await request("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.serverInfo.name, "d2");
  proc.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const { tools } = await request("tools/list", {});
  for (const name of ["guide", "check", "render"]) {
    assert.ok(tools.some((tool) => tool.name === name), name);
  }
  const result = await request("tools/call", { name: "render", arguments: { source: "a -> b" } });
  const image = result.content.find((item) => item.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.equal(Buffer.from(image.data, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
