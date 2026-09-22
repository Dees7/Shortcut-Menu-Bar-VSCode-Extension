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

// keep whatever indentation the manifest already uses
function indentOf(raw: string) {
  const match = /\n([\t ]+)"/.exec(raw);
  return match ? match[1] : "  ";
}

/**
 * Bring the title and icon of every user button in package.json in line with
 * the settings. 'changed' tells whether the file was rewritten, i.e. whether a
 * window reload is needed for the change to show up; settings that could not
 * be applied are reported in 'errors' and leave that button at its default.
 */
export function syncUserButtons(extensionPath: string): {
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

export function affectsUserButtons(affects: (section: string) => boolean) {
  for (let index = 1; index <= USER_BUTTON_COUNT; index++) {
    const action = "ShortcutMenuBar." + userButtonAction(index);
    if (affects(action + "Title") || affects(action + "Icon")) {
      return true;
    }
  }
  return false;
}
