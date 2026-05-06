import { homedir } from "node:os";
import { join } from "node:path";

/**
 * XDG-aware config / cache / data dir resolution. Windows uses APPDATA / LOCALAPPDATA.
 * macOS uses XDG_CONFIG_HOME if set, otherwise the standard ~/Library paths are NOT used —
 * we deliberately stick with XDG semantics on macOS for consistency with developer tooling.
 */

const home = homedir();

function xdg(env: string, fallback: string): string {
  return process.env[env] || fallback;
}

export function configDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "architect");
  }
  return join(xdg("XDG_CONFIG_HOME", join(home, ".config")), "architect");
}

export function cacheDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "architect", "cache");
  }
  return join(xdg("XDG_CACHE_HOME", join(home, ".cache")), "architect");
}

export function dataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "architect", "data");
  }
  return join(xdg("XDG_DATA_HOME", join(home, ".local", "share")), "architect");
}

export const configFile = (): string => join(configDir(), "config.toml");
