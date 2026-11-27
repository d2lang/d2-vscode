const fs = require("node:fs");
const path = require("node:path");

// The SDK resolves its worker and WASM relative to the Node entry point.
module.exports = function prepareSdk() {
  const entry = require.resolve("@d2lang/d2");
  const sdk = path.resolve(path.dirname(entry), "../..");
  const output = path.resolve(__dirname, "../dist/sdk");
  for (const name of [
    "dist/node-cjs/index.js",
    "dist/node-cjs/worker.js",
    "dist/wasm/d2.wasm",
    "dist/wasm/wasm_exec.js",
    "LICENSE.txt",
    "THIRD_PARTY_NOTICES.txt",
  ]) {
    const target = path.join(output, name.replace(/^dist\//, ""));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (name === "dist/node-cjs/worker.js") {
      // VS Code 1.73 uses Node 16, where Web Crypto exists in node:crypto
      // but is not exposed on the worker global used by Go's WASM bootstrap.
      const bootstrap = 'globalThis.crypto ??= require("node:crypto").webcrypto;\n';
      fs.writeFileSync(target, bootstrap + fs.readFileSync(path.join(sdk, name), "utf8"));
    } else {
      fs.copyFileSync(path.join(sdk, name), target);
    }
  }
};
