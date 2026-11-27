// Build the protocol and export commands for the VSIX. End users only run the
// packaged WebAssembly with the editor's Node runtime, including in Remote workspaces.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const version = "v0.10.0";
const checksum = "h1:rEYlzI6SlwQwCYN2yDCLIEHV11ZyBnP/GXFfUwbkn8Q=";
const env = { ...process.env, GOTOOLCHAIN: "go1.27.4", GOWORK: "off" };
const output = path.resolve(__dirname, "../dist/runtime");

function go(args, options = {}) {
  return execFileSync("go", args, { env, encoding: "utf8", ...options });
}

const source = JSON.parse(go(["mod", "download", "-json", "github.com/d2lang/d2@" + version]));
if (source.Sum !== checksum) throw new Error("D2 module checksum mismatch");

fs.mkdirSync(output, { recursive: true });
// Use Node DNS and sockets only for the WASM build of D2's HTTP asset client.
// Keep D2's full IP classification, redirect handling and image limits in Go.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "d2-wasm-build-"));
// Stage the immutable module in writable directories. Reflinks avoid duplicating
// the module on filesystems that support them. Go refuses overlays in GOMODCACHE.
function stage(dir, destination) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const input = path.join(dir, entry.name);
    const output = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(output);
      stage(input, output);
    } else {
      fs.copyFileSync(input, output, fs.constants.COPYFILE_FICLONE);
    }
  }
}
try {
  stage(source.Dir, temp);
  const netpolicy = path.join(temp, "lib/netpolicy/netpolicy.go");
  const original = fs.readFileSync(netpolicy, "utf8");
  const constructor = "func NewHTTPClient(";
  if (original.split(constructor).length !== 2) {
    throw new Error("D2 netpolicy constructor changed; review the Node transport");
  }
  fs.chmodSync(netpolicy, 0o644);
  fs.writeFileSync(netpolicy, original.replace(constructor, "func nativeHTTPClient("));
  const extra = "transport_node_js.go";
  fs.copyFileSync(path.join(__dirname, "wasm", extra), path.join(path.dirname(netpolicy), extra));
  go(
    [
      "build", "-mod=readonly", "-buildvcs=false", "-trimpath",
      "-ldflags", "-s -w -X github.com/d2lang/d2/lib/version.Version=" + version,
      "-o", path.join(output, "d2.wasm"), ".",
    ],
    {
      cwd: temp,
      env: { ...env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
      stdio: "inherit",
    },
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
const goroot = go(["env", "GOROOT"]).trim();
// Go's module cache is read-only. Keep build outputs writable for later builds.
function copyText(sourcePath, name) {
  const destination = path.join(output, name);
  if (fs.existsSync(destination)) fs.chmodSync(destination, 0o644);
  fs.writeFileSync(destination, fs.readFileSync(sourcePath));
}
copyText(path.join(goroot, "lib/wasm/wasm_exec.js"), "wasm_exec.js");
copyText(path.join(goroot, "LICENSE"), "Go-LICENSE.txt");
for (const name of ["LICENSE.txt", "THIRD_PARTY_NOTICES.txt"]) {
  copyText(path.join(source.Dir, name), name);
}
