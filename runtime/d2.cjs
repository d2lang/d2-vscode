// The Go JS target uses asynchronous Node filesystem calls, so the language
// server can publish diagnostics while it waits for the next editor request.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const globals = {
  d2HTTP: require("./http.cjs"),
  fs, path, process, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder,
  WebAssembly, Uint8Array, Uint8ClampedArray, Error, crypto: require("node:crypto").webcrypto,
  fetch: globalThis.fetch, Headers: globalThis.Headers, AbortController: globalThis.AbortController,
};

const toGoPath = (value) => {
  if (process.platform !== "win32") return value;
  const normalized = value.replace(/\\/g, "/");
  return /^[a-z]:\//i.test(normalized) ? "/" + normalized : normalized;
};
const toHostPath = (value) => typeof value === "string" && /^\/[a-z]:\//i.test(value)
  ? value.slice(1)
  : value;

if (process.platform === "win32") {
  // Go's JS target uses POSIX paths. File URIs already have the shape
  // /C:/dir/file; translate at the filesystem boundary, including symlinks.
  const bridge = Object.create(fs);
  for (const name of [
    "open", "stat", "lstat", "mkdir", "readdir", "unlink", "rmdir", "chmod",
    "chown", "lchown", "utimes", "rename", "truncate", "link", "symlink",
  ]) {
    bridge[name] = (...args) => fs[name](...args.map(toHostPath));
  }
  bridge.readlink = (file, cb) => fs.readlink(toHostPath(file), (err, result) =>
    cb(err, err ? undefined : toGoPath(result)));
  globals.fs = bridge;
  globals.path = {
    resolve: (...parts) => toGoPath(path.resolve(...parts.map(toHostPath))),
  };
  globals.process = {
    argv0: process.argv0,
    pid: process.pid,
    ppid: process.ppid,
    cwd: () => toGoPath(process.cwd()),
    chdir: (dir) => process.chdir(toHostPath(dir)),
    getuid: () => -1,
    getgid: () => -1,
    geteuid: () => -1,
    getegid: () => -1,
    getgroups: () => [],
    umask: process.umask.bind(process),
  };
}
// Keep Go's filesystem adapters separate from the Node process and its own fs.
const runtimeDir = path.join(__dirname, "../dist/runtime");
const shim = path.join(runtimeDir, "wasm_exec.js");
vm.runInNewContext(fs.readFileSync(shim, "utf8"), globals, { filename: shim });
const go = new globals.Go();
const args = process.argv.slice(2);
// Old VS Code requires this switch to run its Electron binary as Node and
// consumes it; newer versions pass it on to the script.
if (args[0] === "--ms-enable-electron-run-as-node") args.shift();
go.argv = ["d2", ...args.map(toGoPath)];
// wasm_exec reserves 8 KiB for argv and env. Extension hosts can carry much
// larger environments; only pass settings used by the packaged D2 commands.
go.env = {};
for (const [name, value] of Object.entries(process.env)) {
  if (/^(D2_|TALA_|XDG_)/.test(name) || ["HOME", "IMG_CACHE", "SCALE", "NO_COLOR"].includes(name)) {
    go.env[name] = value;
  }
}
go.env.TMPDIR = toGoPath(os.tmpdir());
if (process.env.D2_MCP_ROOT) go.env.D2_MCP_ROOT = toGoPath(process.env.D2_MCP_ROOT);
go.exit = (status) => process.exit(status);
const binary = path.join(__dirname, "../dist/runtime/d2.wasm");
WebAssembly.instantiate(fs.readFileSync(binary), go.importObject)
  .then(({ instance }) => go.run(instance))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
