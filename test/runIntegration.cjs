const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  assert(process.env.D2_LSP_BIN, "Set D2_LSP_BIN to a D2 executable with 'lsp'.");
  assert(
    process.env.D2_LEGACY_BIN,
    "Set D2_LEGACY_BIN to a D2 executable without 'lsp'.",
  );
  const native = await fs.realpath(process.env.D2_LSP_BIN);
  const legacy = await fs.realpath(process.env.D2_LEGACY_BIN);
  const extension = path.resolve(__dirname, "..");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "d2-vscode-"));
  try {
    const folder = path.join(temp, "test diagrams");
    const profile = path.join(temp, "profile");
    await fs.mkdir(folder);
    await fs.mkdir(path.join(profile, "User"), { recursive: true });
    await fs.writeFile(
      path.join(profile, "User", "settings.json"),
      JSON.stringify({ "D2.execPath": native, "D2.checkForInstallAtStart": false }),
    );
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      cachePath: path.join(extension, "node_modules", ".cache", "vscode-test"),
      extensionDevelopmentPath: extension,
      extensionTestsPath: path.join(__dirname, "languageServer.cjs"),
      extensionTestsEnv: { D2_LSP_BIN: native, D2_LEGACY_BIN: legacy },
      launchArgs: [
        folder,
        "--disable-extensions",
        `--user-data-dir=${profile}`,
        `--extensions-dir=${path.join(temp, "extensions")}`,
      ],
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
