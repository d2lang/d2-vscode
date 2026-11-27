const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { test } = require("node:test");
const { registerD2Mcp } = require("../node_modules/.cache/d2-test/mcpServer");
const manifest = require("../package.json");

class EventEmitter {
  listeners = new Set();
  event = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {
    this.listeners.clear();
  }
}

test("older editors activate without an MCP API", () => {
  registerD2Mcp({ version: "1.73.1" }, { subscriptions: [] });
  registerD2Mcp({ version: "1.101.0", lm: {} }, { subscriptions: [] });
  const proposed = { registerMcpServerDefinitionProvider: () => assert.fail() };
  registerD2Mcp({ version: "1.100.3", lm: proposed }, { subscriptions: [] });
});

test("publishes only the current trusted D2 executable with MCP support", (t) => {
  const probes = [];
  t.mock.method(childProcess, "execFile", (command, args, options, finish) => {
    assert.deepEqual(args, ["mcp", "--help"]);
    assert(options.timeout > 0);
    probes.push({ command, finish });
    return { kill() {} };
  });

  let executable = "/opt/D2 Tools/d2";
  const config = new EventEmitter();
  const trust = new EventEmitter();
  let provider;
  const workspace = {
    isTrusted: false,
    onDidChangeConfiguration: config.event,
    onDidGrantWorkspaceTrust: trust.event,
    getConfiguration: () => ({ get: () => executable }),
  };
  const api = {
    version: "1.101.0",
    EventEmitter,
    workspace,
    Disposable: class {
      constructor(dispose) {
        this.dispose = dispose;
      }
    },
    McpStdioServerDefinition: class {
      constructor(label, command, args, env) {
        Object.assign(this, { label, command, args, env });
      }
    },
    lm: {
      registerMcpServerDefinitionProvider(id, value) {
        assert.equal(id, manifest.contributes.mcpServerDefinitionProviders[0].id);
        provider = value;
        return { dispose() {} };
      },
    },
  };
  const context = { subscriptions: [], extensionPath: process.cwd() };
  registerD2Mcp(api, context);
  const servers = () => provider.provideMcpServerDefinitions();
  const updates = [];
  provider.onDidChangeMcpServerDefinitions(() => updates.push(servers()));
  assert.deepEqual(servers(), []);
  assert.equal(probes.length, 0);

  workspace.isTrusted = true;
  trust.fire();
  const help = "Usage:\r\n  d2 mcp [--root dir] [--no-ui] [--timeout seconds]\r\n";
  assert.equal(probes[0].command, executable);
  probes[0].finish(null, help);
  assert.equal(servers()[0].label, "D2");
  assert.equal(servers()[0].command, executable);
  assert.deepEqual(servers()[0].args, ["mcp"]);
  assert.equal(updates.length, 1);

  const change = (path) => {
    executable = path;
    config.fire({ affectsConfiguration: (key) => key === "D2.execPath" });
  };
  change("slow-d2");
  assert.deepEqual(servers(), []);
  assert.equal(updates.length, 2);
  change("legacy-d2");
  probes[2].finish(null, "d2 v0.9.0\nUsage:\n  d2 [--watch=false] file.d2 [file.svg]");
  probes[1].finish(null, help);
  assert.deepEqual(servers(), []);
  change("missing-d2");
  probes[3].finish(new Error("ENOENT"), "");
  assert.deepEqual(servers(), []);
  for (const defaultSetting of ["", "d2"]) {
    change(defaultSetting);
    assert.equal(servers()[0].command, process.execPath);
    assert.equal(servers()[0].args[0], require("node:path").join(process.cwd(), "runtime", "d2.cjs"));
    assert.equal(servers()[0].args.at(-1), "mcp");
    assert.deepEqual(servers()[0].env, { ELECTRON_RUN_AS_NODE: "1" });
    assert.equal(probes.length, 4, "the packaged server never probes PATH");
  }
  change("custom-d2");
  for (const subscription of context.subscriptions) subscription.dispose();
  probes[4].finish(null, help);
  assert.deepEqual(servers(), []);
  assert.equal(updates.length, 6);
});
