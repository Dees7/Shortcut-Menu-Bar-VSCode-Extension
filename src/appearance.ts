/*
   Copyright (C) 2018-2021 Gourav Goyal and contributors.

   This file is part of the Shortcut Menu Bar extension.

   The Shortcut Menu Bar extension is free software: you can redistribute it
   and/or modify it under the terms of the GNU Lesser General Public License
   as published by the Free Software Foundation, either version 3 of the
   License, or (at your option) any later version.

   The Shortcut Menu Bar extension is distributed in the hope that it will
   be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU Lesser General Public License for more details.

   You should have received a copy of the GNU Lesser General Public License along
   with the Shortcut Menu Bar extension. If not,see <https://www.gnu.org/licenses/>.
*/

"use strict";

// Title and icon of a button live in package.json: VSCode reads them once when
// the extension is loaded and offers no API to change them later. To make them
// configurable we rewrite our own package.json and ask for a window reload.

import { homedir } from "os";
import { extname, isAbsolute, join, resolve } from "path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { extensions, workspace } from "vscode";

export const USER_BUTTON_COUNT = 10;

// icons copied out of the user's own folders live here, next to the stock ones
const CUSTOM_ICON_DIR = join("images", "custom-resolved");

type IconSpec = string | { light: string; dark: string };

export function userButtonAction(index: number) {
  return "userButton" + (index !== 10 ? "0" + index : "" + index);
}

// button 10 is labelled 'user action 0' to match its ctrl+alt+0 keybinding
function defaultTitle(index: number) {
  return "user action " + (index % 10);
}

function defaultIcon(action: string): IconSpec {
  return {
    light: "images/" + action + "_light.svg",
    dark: "images/" + action + ".svg",
  };
}

// package.json is shared by every window of this VSCode installation, so a
// workspace-level override would make windows fight over it: only User values
// are taken into account.
function globalSetting(key: string) {
  const inspected = workspace
    .getConfiguration("ShortcutMenuBar")
    .inspect<string>(key);
  const value = inspected?.globalValue ?? inspected?.defaultValue;
  return typeof value === "string" ? value.trim() : "";
}

function globalListSetting(key: string) {
  const inspected = workspace
    .getConfiguration("ShortcutMenuBar")
    .inspect<string[]>(key);
  const value = inspected?.globalValue ?? inspected?.defaultValue;
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim())
    : [];
}

function globalMapSetting(key: string) {
  const inspected = workspace
    .getConfiguration("ShortcutMenuBar")
    .inspect<Record<string, string>>(key);
  const value = inspected?.globalValue ?? inspected?.defaultValue;
  const entries = value && typeof value === "object" ? Object.entries(value) : [];
  return new Map(
    entries
      .filter(([, condition]) => typeof condition === "string")
      .map(([action, condition]) => [action, condition.trim()])
  );
}

function expandHome(path: string) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path.replace(/\$\{userHome\}/g, homedir());
}

// 'extension:publisher.name/path/icon.svg' points at a file of another
// installed extension. Its folder is looked up through the API instead of being
// spelled out, because the folder name carries a version that changes on every
// update of that extension.
const EXTENSION_REF = /^extension:([^/\\]+)[/\\](.+)$/;

function resolveSource(extensionPath: string, token: string) {
  const reference = EXTENSION_REF.exec(token);
  if (reference) {
    const [, id, relative] = reference;
    const owner = extensions.getExtension(id);
    if (!owner) {
      throw new Error(`extension '${id}' is not installed`);
    }
    return join(owner.extensionPath, relative);
  }

  const expanded = expandHome(token);
  return isAbsolute(expanded) ? expanded : resolve(extensionPath, expanded);
}

function copyIfChanged(from: string, to: string) {
  if (existsSync(to) && readFileSync(to).equals(readFileSync(from))) {
    return false;
  }
  copyFileSync(from, to);
  return true;
}

// A custom icon is either a built-in icon like '$(rocket)' — used as is — or one
// or two image files, which get copied inside the extension folder because
// VSCode resolves icon paths relative to it. Both files are given as
// 'dark|light'; with a single one, a sibling suffixed with '_light' is picked up
// for the light theme, following the naming of the stock icons, and failing that
// the same image serves both themes.
// 'copied' reports a new image behind an unchanged path, which needs a reload
// just as much as a changed path does.
function customIcon(
  extensionPath: string,
  action: string,
  setting: string
): { icon: IconSpec; copied: boolean } {
  if (setting.startsWith("$(") && setting.endsWith(")")) {
    return { icon: setting, copied: false };
  }

  const [darkToken, lightToken] = setting.split("|").map((part) => part.trim());

  const darkSource = resolveSource(extensionPath, darkToken);
  if (!existsSync(darkSource)) {
    throw new Error(`icon file '${darkToken}' of ${action} not found`);
  }

  let lightSource;
  if (lightToken) {
    lightSource = resolveSource(extensionPath, lightToken);
    if (!existsSync(lightSource)) {
      throw new Error(`light icon file '${lightToken}' of ${action} not found`);
    }
  } else {
    const suffix = extname(darkSource);
    const sibling =
      darkSource.slice(0, darkSource.length - suffix.length) + "_light" + suffix;
    lightSource = existsSync(sibling) ? sibling : darkSource;
  }

  mkdirSync(join(extensionPath, CUSTOM_ICON_DIR), { recursive: true });
  const dark = join(CUSTOM_ICON_DIR, action + extname(darkSource));
  const light = join(CUSTOM_ICON_DIR, action + "_light" + extname(lightSource));
  const copiedDark = copyIfChanged(darkSource, join(extensionPath, dark));
  const copiedLight = copyIfChanged(lightSource, join(extensionPath, light));

  return {
    // package.json wants forward slashes regardless of the platform
    icon: {
      light: light.split("\\").join("/"),
      dark: dark.split("\\").join("/"),
    },
    copied: copiedDark || copiedLight,
  };
}

function sameIcon(current: IconSpec | undefined, wanted: IconSpec) {
  if (typeof wanted === "string" || typeof current === "string") {
    return current === wanted;
  }
  return (
    current !== undefined &&
    current.light === wanted.light &&
    current.dark === wanted.dark
  );
}

// VSCode caches the manifests of all scanned extensions and checks that cache
// against the modification time of the extensions.json index, not against the
// manifests themselves. Editing our own package.json therefore leaves a cache
// that still looks up to date, and the first reload draws the buttons from it,
// with the previous icons; only the reload after that shows the new ones.
// Touching the index makes VSCode drop the cache and rescan, so one reload is
// enough. Only the timestamp is changed, never the contents.
function dropScanCache(extensionPath: string) {
  try {
    const index = join(extensionPath, "..", "extensions.json");
    if (existsSync(index)) {
      const now = new Date();
      utimesSync(index, now, now);
    }
  } catch {
    // not fatal: without it the new icons simply need one more reload
  }
}

type MenuItem = { command: string; group?: string; when?: string };

function menuAction(item: MenuItem) {
  return item.command.replace("ShortcutMenuBar.", "");
}

// A condition from the settings is appended to the one the button already has,
// as '<built-in> && (<yours>)'. Since no built-in condition contains brackets,
// the first ' && (' marks where ours begins and the built-in part can always be
// recovered — which is what makes clearing the setting bring the button back.
// A button without a built-in condition gets 'true' in its place, since
// '&& (<yours>)' on its own is not an expression VSCode accepts; the marker
// then still stands where it is expected and the button comes back the same
// way as any other one.
const CONDITION_MARKER = " && (";
const ALWAYS = "true";

function builtInWhen(when: string) {
  const marker = when.indexOf(CONDITION_MARKER);
  const builtIn =
    marker >= 0 && when.endsWith(")") ? when.slice(0, marker) : when;
  return builtIn === ALWAYS ? "" : builtIn;
}

/**
 * Narrow down when each button is shown, after the 'buttonWhen' setting. The
 * conditions are the ones used by keyboard shortcuts, and they are added to the
 * condition a button already has rather than replacing it, so a button stays
 * hidden while it is switched off or, for a user button, has no command.
 */
function applyButtonVisibility(items: MenuItem[]) {
  const errors: string[] = [];
  const conditions = globalMapSetting("buttonWhen");

  const known = new Set(items.map(menuAction));
  for (const action of conditions.keys()) {
    if (!known.has(action)) {
      errors.push(`unknown button '${action}' in buttonWhen`);
    }
  }

  let changed = false;
  for (const item of items) {
    const builtIn = builtInWhen(item.when ?? "");
    const condition = conditions.get(menuAction(item));
    const when = condition
      ? (builtIn || ALWAYS) + CONDITION_MARKER + condition + ")"
      : builtIn;
    if ((item.when ?? "") !== when) {
      if (when) {
        item.when = when;
      } else {
        delete item.when;
      }
      changed = true;
    }
  }

  return { changed, errors };
}

/**
 * Renumber the buttons of the editor title bar after the 'buttonOrder' setting.
 * Buttons it names come first, in the order given; the rest keep the order they
 * have in the manifest, which stays the default because only the group of an
 * entry is rewritten here, never the position of the entry itself.
 *
 * Numbering starts at 1 and stays inside the range the buttons already occupy:
 * the group is shared with every other extension that puts something in the
 * title bar, so moving out of that range would shift all our buttons past
 * theirs.
 */
function applyButtonOrder(items: MenuItem[]) {
  const errors: string[] = [];
  const byAction = new Map<string, MenuItem>();
  for (const item of items) {
    byAction.set(menuAction(item), item);
  }

  const ordered: MenuItem[] = [];
  for (const action of globalListSetting("buttonOrder")) {
    const item = byAction.get(action);
    if (!item) {
      errors.push(`unknown button '${action}' in buttonOrder`);
      continue;
    }
    if (!ordered.includes(item)) {
      ordered.push(item);
    }
  }
  for (const item of items) {
    if (!ordered.includes(item)) {
      ordered.push(item);
    }
  }

  let changed = false;
  ordered.forEach((item, index) => {
    const group = "navigation@" + (index + 1);
    if (item.group !== group) {
      item.group = group;
      changed = true;
    }
  });

  return { changed, errors };
}

// keep whatever indentation the manifest already uses
function indentOf(raw: string) {
  const match = /\n([\t ]+)"/.exec(raw);
  return match ? match[1] : "  ";
}

/**
 * Bring package.json in line with the settings: the title and icon of every
 * user button, and the order of all the buttons. 'changed' tells whether the
 * file was rewritten, i.e. whether a window reload is needed for the change to
 * show up; settings that could not be applied are reported in 'errors' and
 * leave that button at its default.
 */
export function syncManifest(extensionPath: string): {
  changed: boolean;
  errors: string[];
} {
  const manifestPath = join(extensionPath, "package.json");
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const errors: string[] = [];
  let changed = false;

  for (let index = 1; index <= USER_BUTTON_COUNT; index++) {
    const action = userButtonAction(index);
    const entry = manifest.contributes?.commands?.find(
      (command: { command: string }) =>
        command.command === "ShortcutMenuBar." + action
    );
    if (!entry) {
      continue;
    }

    const title = globalSetting(action + "Title") || defaultTitle(index);

    const iconSetting = globalSetting(action + "Icon");
    let icon = defaultIcon(action);
    if (iconSetting) {
      try {
        const custom = customIcon(extensionPath, action, iconSetting);
        icon = custom.icon;
        changed = changed || custom.copied;
      } catch (err: any) {
        errors.push(err.message);
      }
    }

    if (entry.title !== title) {
      entry.title = title;
      changed = true;
    }
    if (!sameIcon(entry.icon, icon)) {
      entry.icon = icon;
      changed = true;
    }
  }

  const buttons = manifest.contributes?.menus?.["editor/title"] ?? [];
  for (const step of [applyButtonOrder(buttons), applyButtonVisibility(buttons)]) {
    changed = changed || step.changed;
    errors.push(...step.errors);
  }

  if (changed) {
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, indentOf(raw)) + "\n",
      "utf8"
    );
    dropScanCache(extensionPath);
  }

  return { changed, errors };
}

export function affectsAppearance(affects: (section: string) => boolean) {
  if (affects("ShortcutMenuBar.buttonOrder") || affects("ShortcutMenuBar.buttonWhen")) {
    return true;
  }
  for (let index = 1; index <= USER_BUTTON_COUNT; index++) {
    const action = "ShortcutMenuBar." + userButtonAction(index);
    if (affects(action + "Title") || affects(action + "Icon")) {
      return true;
    }
  }
  return false;
}
