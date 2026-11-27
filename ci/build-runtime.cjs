// Build the protocol and export commands for the VSIX. End users only run the
// packaged WebAssembly with the editor's Node runtime, including in Remote workspaces.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
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
go(
  [
    "build", "-mod=readonly", "-buildvcs=false", "-trimpath",
    "-ldflags", "-s -w -X github.com/d2lang/d2/lib/version.Version=" + version,
    "-o", path.join(output, "d2.wasm"), ".",
  ],
  {
    cwd: source.Dir,
    env: { ...env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
    stdio: "inherit",
  },
);
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
