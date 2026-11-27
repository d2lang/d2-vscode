const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { test } = require("node:test");
const { pathToFileURL, fileURLToPath } = require("node:url");
const rpc = require("vscode-jsonrpc/node");
const launcher = path.resolve(__dirname, "../runtime/d2.cjs");

test("the HTTPS adapter pins the socket address and verifies the original TLS name", (t) => {
  const https = require("node:https");
  let options;
  t.mock.method(https, "get", (value) => {
    options = value;
    return { on() {}, destroy() {} };
  });
  require("../runtime/http.cjs").open("https", "1.1.1.1", "example.org", "", "example.org", "/icon.svg", {});
  assert.equal(options.hostname, "1.1.1.1");
  assert.equal(options.headers.host, "example.org");
  assert.equal(options.servername, "example.org");
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity("1.1.1.1", { subjectaltname: "DNS:example.org" }), undefined);
  assert.ok(options.checkServerIdentity("1.1.1.1", { subjectaltname: "DNS:other.example.org" }));
});

function start(t, args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "D2 protocol "));
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

test("WASM asset requests obey network policy, redirects, encodings and byte limits", {
  timeout: 30_000,
}, async (t) => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12"/></svg>';
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/icon.svg" }).end();
    } else if (req.url === "/oversize") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Length": 2 ** 30 });
      res.flushHeaders();
      // The client must reject from headers without waiting for a response body.
    } else {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Encoding": "gzip" });
      res.end(require("node:zlib").gzipSync(icon));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  function render(route, trusted = false) {
    return new Promise((resolve) => {
      const child = execFile(process.execPath, [launcher, "--bundle", "-", "-"], {
        timeout: 15_000,
        env: { ...process.env, PATH: "", D2_ALLOW_PRIVATE_NETWORK: String(trusted) },
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
      child.stdin.end("node.icon: " + base + route);
    });
  }
  assert.ok((await render("/redirect")).error);
  assert.deepEqual(requests, [], "public-only mode never opens a loopback socket");
  const { error, stdout } = await render("/redirect", true);
  assert.ifError(error);
  assert.match(stdout, /href="data:image\/svg\+xml;base64,/);
  assert.deepEqual(requests, ["/redirect", "/icon.svg"]);
  const oversize = await render("/oversize", true);
  assert.ok(oversize.error);
  assert.match(oversize.stderr, /fetched bytes/);
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
