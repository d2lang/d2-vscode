<div align="center">
  <br />
  <div align="center">
    <img src="https://raw.githubusercontent.com/d2lang/d2-vscode/master/docs/assets/header.png" alt="D2" />
  </div>
  <br />
</div>

[![ci](https://github.com/d2lang/d2-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/d2lang/d2-vscode/actions/workflows/ci.yml)
[![daily](https://github.com/d2lang/d2-vscode/actions/workflows/daily.yml/badge.svg)](https://github.com/d2lang/d2-vscode/actions/workflows/daily.yml)
[![license](https://img.shields.io/github/license/d2lang/d2-vscode?color=9cf)](./LICENSE.txt)

# d2lang

The official [D2](https://d2lang.com) extension for Visual Studio Code.

Install the extension to preview, format, and export diagrams offline. It includes
D2.js with Dagre, ELK, and TALA, plus the D2 language server and MCP server.

## Currently Supports

- Syntax highlighting `.d2` files
- Open preview window on the side (right-click or (ctrl+shift+d) (mac -> shift+cmd+d))
- Format Document for `.d2` files
- Autocomplete, hover, live diagnostics, outline, folding, color pickers, and links with the D2 language server
- Go to Definition, Find All References, and Rename Symbol across D2 imports
- Format a fenced `d2` block in Markdown. Place the cursor inside the block or select it, then run **d2: Format D2 Block** from the Command Palette or **Format D2 Block** from the editor context menu.
- View rendered D2 code snippets in markdown document preview
- Previews follow the diagram’s layout, theme and sketch settings. Choose a layout or theme in the Command Palette to override it. Choose `diagram` in either picker or reset `D2.previewSketch` to follow the source again.

```d2
x -> y

# d2-vscode can syntax highlight nested markdown correctly.
y: |`md
  # d2-vscode
  VSCode extension for [D2](https://d2lang.com) files.
`|
```

## Export

Run **d2: Export Diagram As...** from a D2 editor or right-click a D2 file in
Explorer. Choose SVG, PNG, PDF, PowerPoint, GIF, or text, then pick where to save
it. The export includes unsaved edits in the source file and resolves imports
relative to that file. It uses the same layout, theme, and sketch settings as
the preview. **Compile D2 to SVG** still writes a sibling SVG in one step.

For diagrams with multiple boards, PDF and PowerPoint include a page or slide
per board. GIF animates the boards. To export an animated SVG, set
`vars.d2-config.animate-interval` in the diagram. PNG and text export the root
board. All six formats are included.

## Diagram snippets

In a D2 file, run **Snippets: Insert Snippet** and choose **D2 sequence
diagram**, **D2 grid**, or **D2 animated steps**. Press Tab to move between
fields. The animated example uses D2 v0.10 or later. In Markdown, choose
**D2 diagram block** to insert a fenced diagram.

## Language server

Open a D2 file to start the bundled language server. It provides completion,
diagnostics, hover, go-to-definition, references, and rename.

For cross-file rename, open the diagrams that import the shape before running
**Rename Symbol**. The server reads unsaved edits in those diagrams and follows
their imports.

Advanced users can set `D2.execPath` to a custom D2 executable for the
language server, MCP, and binary exports. Clearing the setting restores the
bundled tools. Preview and Markdown formatting use D2.js.

## AI diagrams with MCP

In a trusted workspace on VS Code 1.101 or later, open **MCP: List Servers**
and select **D2** to use the bundled server. Ask your agent to “Use D2 to draw
a diagram of an API sending jobs to a queue.” The server can check the source
and return a rendered diagram.

See the [D2 MCP guide](https://d2lang.com/tour/mcp/) for a worked example.

## Example

<div align="center">
  <img src="./docs/assets/d2_vscode.gif" alt="D2" />
</div>

## Install

Install **d2lang** from the Extensions sidebar or the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=d2lang.d2lang).

If you use the earlier `terrastruct.d2` extension, disable or uninstall it before
installing this one. The two extensions register the same D2 commands.
If your user or workspace settings specify `terrastruct.d2` as the default
formatter under `[d2]`, change `editor.defaultFormatter` to
`d2lang.d2lang`.

## Contributing

Building from source requires Node.js, Yarn Classic, and Go. The build compiles
the D2 protocol servers and binary exporters from a checksum-pinned release
into a portable WebAssembly module. The VSIX includes that module, its Go
runtime glue, and the Node distribution of D2.js.

```sh
yarn install --frozen-lockfile
yarn pkg
code --install-extension d2.vsix
```

### CI

CI relies on D2's shared [CI submodule](https://github.com/d2lang/ci).

Run `yarn test:integration` to exercise the bundled tools in VS Code with D2
absent from `PATH`. Set `VSCODE_EXECUTABLE_PATH` to test an existing VS Code
installation.

To run all CI: `./make.sh`.

To run individual jobs:

- Format: `./make.sh fmt`
- Lint: `./make.sh lint`
- Build: `./make.sh build`

Jobs only run on changed files. To force it to run on all files, add `CI_FORCE=1`. This is
what daily job does.

```
CI_FORCE=1 ./make.sh fmt
```

### Packaging

```sh
vsce package
```

Upload the output `.vsix` onto
[the D2lang publisher dashboard](https://marketplace.visualstudio.com/manage/publishers/d2lang).

### launch.json

We have a `.vscode/launch.json` that enables starting a separate debug VS Code with the
extension installed without affecting your existing VS Code instance. To use, open
`d2-vscode` with VS Code and hit `F5`. Press `CMD+R` after making changes to restart the
debug VS Code with the updated extension.

### Generating tmLanguage.json

To regenerate `d2.tmLanguage.json` after updating `d2.tmLanguage.yaml`, use [yq](https://github.com/mikefarah/yq/#install):

```sh
brew install yq
npm run gen
```

note: `npm run dev` will regenerate for you.

### Debugging Keybind

Highly recommend the following keybind for inspecting the textmate scopes under the cursor.

```json
{
  "key": "cmd+i",
  "command": "editor.action.inspectTMScopes"
}
```

### Offline Distribution

See https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix

```sh
npm install -g @vscode/vsce
npm run pkg
# To install:
# code --install-extension d2.vsix
# To uninstall:
# code --uninstall-extension d2lang.d2lang
```

### markdown.tmLanguage.json

Syntax file used for markdown embedded within d2 block strings.

1. Copied from VS Code's markdown-basics extension.
2. Renamed to `markdown.d2` and scope to `text.html.markdown.d2`
3. Then with vim:
   ```
   %s/\(?:\)\?\^|\\\\G/\1(?!.*`\\\\|)(?:\^|\\\\G)/g
   ```

- This replacement ensures the markdown syntax never matches on block string
  terminators.

4. Then with sed:
   ```sh
   gsed -i -E 's/\[ \]\{[^}]*?\}/\\\\s*/' markdown.tmLanguage.json
   ```

- This replacement ensures that the markdown syntax doesn't consider leading spaces to be
  the beginning of an indented code block as in d2, block strings are indented for
  readability without the indentation being part of the string contents.

5. Now delete the `list` from `#block`. Lists for some reason eat the block string
   terminator. e.g. with them enabled the following syntax after the terminating `|`
   will remain markdown:

   ```d2
   my shape: |md
     1. first
   |

   should be d2 but VS Code highlights as markdown.
   ```

6. Add `fenced_code_block_d2` based on `fenced_code_block_css` to allow embedding markdown
   with d2 within d2.
