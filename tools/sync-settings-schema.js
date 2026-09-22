// Rebuilds the parts of the settings schema that list every button — the values
// 'ShortcutMenuBar.buttonOrder' accepts and the keys of 'ShortcutMenuBar.buttonWhen'
// — out of the buttons themselves, so that adding a button needs no hand editing
// and the labels cannot drift apart from the ids they belong to.
//
//   npm run sync-schema

"use strict";

const { readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

const manifestPath = join(__dirname, "..", "package.json");
const raw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);

const shortId = (command) => command.replace("ShortcutMenuBar.", "");

// the order buttons appear in the title bar by default, which is the order of
// the menu entries themselves
const buttons = manifest.contributes.menus["editor/title"].map((entry) => shortId(entry.command));
const titles = new Map(
  manifest.contributes.commands.map((command) => [shortId(command.command), command.title])
);

const missing = buttons.filter((id) => !titles.has(id));
if (missing.length > 0) {
  throw new Error(`buttons without a command: ${missing.join(", ")}`);
}

const properties = manifest.contributes.configuration[0].properties;

const order = properties["ShortcutMenuBar.buttonOrder"].items;
order.enum = buttons;
order.enumDescriptions = buttons.map((id) => titles.get(id));

const when = properties["ShortcutMenuBar.buttonWhen"];
when.properties = Object.fromEntries(
  buttons.map((id) => [
    id,
    {
      type: "string",
      markdownDescription: `when to show the '${titles.get(id)}' button, e.g. \`editorLangId == python\``,
    },
  ])
);

const updated = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(manifestPath, updated, "utf8");
console.log(
  `${buttons.length} buttons` + (updated === raw ? ", schema was already up to date" : ", schema updated")
);
