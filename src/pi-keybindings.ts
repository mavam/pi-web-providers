import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, keyText } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  KeybindingsManager,
  type KeybindingsConfig,
} from "@earendil-works/pi-tui";

export function expansionKey(): string {
  const id = "app.tools.expand";
  const key = keyText(id);
  if (key || getKeybindings().getDefinition(id)) return key;
  // A native-loaded bundle can see a separate, TUI-only singleton. In that
  // case use Pi's documented configuration, including legacy key names.
  let configured: unknown;
  try {
    const settings = JSON.parse(
      readFileSync(join(getAgentDir(), "keybindings.json"), "utf8"),
    );
    configured = settings?.[id] ?? settings?.expandTools;
  } catch {
    // Pi also uses defaults when its keybinding file is absent or unreadable.
  }
  const binding =
    typeof configured === "string" ||
    (Array.isArray(configured) &&
      configured.every((key) => typeof key === "string"))
      ? configured
      : "ctrl+o";
  const keys = new KeybindingsManager({ [id]: { defaultKeys: "ctrl+o" } }, {
    [id]: binding,
  } as KeybindingsConfig).getKeys(id);
  return keys
    .map((key) =>
      key
        .split("+")
        .map((part) =>
          process.platform === "darwin" && part.toLowerCase() === "alt"
            ? "option"
            : part,
        )
        .join("+"),
    )
    .join("/");
}
