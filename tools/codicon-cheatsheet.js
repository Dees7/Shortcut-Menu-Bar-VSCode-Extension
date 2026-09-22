// Builds a local cheat sheet of the icons built into VSCode, to pick ids for the
// 'ShortcutMenuBar.userButtonXXIcon' setting and for 'contributes.commands'.
// Fonts and ids are read from the installed VSCode, so what you see is what the
// editor will actually draw.
//
//   node tools/codicon-cheatsheet.js [path to the VSCode app folder]

"use strict";

const { execFileSync } = require("child_process");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir, platform } = require("os");

const CANDIDATES = {
  darwin: [
    "/Applications/Visual Studio Code.app/Contents/Resources/app",
    join(process.env.HOME || "", "Applications/Visual Studio Code.app/Contents/Resources/app"),
  ],
  linux: ["/usr/share/code/resources/app", "/usr/lib/code", "/opt/visual-studio-code/resources/app"],
  win32: [join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/resources/app")],
};

const CSS = "extensions/simple-browser/media/codicon.css";
const TTF = "out/media/codicon.ttf";

function findAppFolder() {
  const given = process.argv[2];
  const folders = given ? [given] : CANDIDATES[platform()] || [];
  const found = folders.find((folder) => existsSync(join(folder, CSS)));
  if (!found) {
    throw new Error(
      "VSCode not found, pass its app folder explicitly: node tools/codicon-cheatsheet.js <folder>\n" +
        "looked into:\n  " +
        folders.join("\n  ")
    );
  }
  return found;
}

function readIcons(appFolder) {
  const css = readFileSync(join(appFolder, CSS), "utf8");
  const pattern = /\.codicon-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g;
  const icons = new Map();
  let match;
  while ((match = pattern.exec(css))) {
    // the first definition wins, later ones are aliases of the same glyph
    if (!icons.has(match[1])) {
      icons.set(match[1], match[2]);
    }
  }
  return [...icons].sort((a, b) => a[0].localeCompare(b[0]));
}

function render(icons, ttfPath) {
  const cells = icons
    .map(
      ([id, codePoint]) =>
        `<div class="c" title="click to copy" onclick="copy('${id}')"><i>&#x${codePoint};</i><span>${id}</span></div>`
    )
    .join("\n");

  return `<!doctype html><meta charset="utf-8"><title>VSCode icons (${icons.length})</title>
<style>
@font-face { font-family: codicon; src: url("file://${ttfPath}") format("truetype") }
body { background:#1e1e1e; color:#ccc; font:13px -apple-system,Segoe UI,sans-serif; margin:0; padding:16px }
h1 { font-size:15px; font-weight:600; margin:0 0 4px }
p { color:#888; margin:0 0 16px }
#filter { width:100%; box-sizing:border-box; padding:8px 10px; margin-bottom:16px; background:#3c3c3c;
  border:1px solid #555; color:#eee; border-radius:4px; font-size:13px }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:4px }
.c { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:4px; cursor:pointer }
.c:hover { background:#2a2d2e }
.c.copied { background:#0e639c }
.c i { font-family:codicon; font-style:normal; font-size:16px; color:#c5c5c5; width:16px; text-align:center }
.c span { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:#9cdcfe;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
</style>
<h1>Icons built into VSCode — ${icons.length} of them</h1>
<p>Click an icon to copy its <code>$(id)</code>, then paste it into the icon setting of a user button.</p>
<input id="filter" placeholder="filter, e.g. fold, layout, git">
<div class="grid" id="grid">
${cells}
</div>
<script>
function copy(id) {
  navigator.clipboard.writeText('$(' + id + ')');
  for (const c of grid.children) { c.classList.toggle('copied', c.textContent.trim() === id); }
}
filter.addEventListener('input', () => {
  const query = filter.value.toLowerCase();
  for (const c of grid.children) { c.style.display = c.textContent.toLowerCase().includes(query) ? '' : 'none'; }
});
</script>
`;
}

const appFolder = findAppFolder();
const icons = readIcons(appFolder);
const output = join(tmpdir(), "vscode-codicons.html");
writeFileSync(output, render(icons, join(appFolder, TTF)), "utf8");
console.log(`${icons.length} icons from ${appFolder}\nwritten to ${output}`);

const open = { darwin: "open", win32: "start", linux: "xdg-open" }[platform()];
if (open) {
  try {
    execFileSync(open, [output]);
  } catch {
    // opening is a convenience, the path is printed above anyway
  }
}
