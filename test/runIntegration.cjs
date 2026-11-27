const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extension = path.resolve(__dirname, "..");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "d2-vscode-"));
  try {
    const folder = path.join(temp, "test diagrams");
    const profile = path.join(temp, "profile");
    await fs.mkdir(folder);
    // The bundled renderer and servers must work when D2 is absent from PATH.
    const emptyPath = path.join(temp, "empty-path");
    await fs.mkdir(emptyPath);
    await fs.mkdir(path.join(profile, "User"), { recursive: true });
    await fs.writeFile(
      path.join(profile, "User", "settings.json"),
      JSON.stringify({ "workbench.startupEditor": "none", "chat.disableAIFeatures": true }),
    );
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      cachePath: path.join(extension, "node_modules", ".cache", "vscode-test"),
      extensionDevelopmentPath: extension,
      extensionTestsPath: path.join(__dirname, "languageServer.cjs"),
      extensionTestsEnv: {
        PATH: emptyPath,
        D2_LEGACY_BIN: process.env.D2_LEGACY_BIN || path.join(temp, "no-external-d2"),
      },
      launchArgs: [
        folder,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
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
