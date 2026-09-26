export type Platform = "mac" | "other";

export type CommandId = "new" | "save" | "panel-toggle" | "browse-folders";

export type Command = {
  id: CommandId;
  name: string;
  /** DOM syntax, used by assistive technology. */
  ariaKeyShortcuts: (platform: Platform) => string;
  label: (platform: Platform) => string;
  matches: (event: KeyboardEvent, platform: Platform) => boolean;
};

const primary = (event: KeyboardEvent, platform: Platform) =>
  platform === "mac"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

const physical = (event: KeyboardEvent, code: string) =>
  event.code === code ||
  event.key.toLowerCase() === code.replace("Key", "").toLowerCase();

const physicalNumber = (event: KeyboardEvent, number: 0 | 1) =>
  event.code === `Digit${number}` || event.code === `Numpad${number}`;

export const platform = (): Platform =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "mac" : "other";

export const commands: Record<CommandId, Command> = {
  new: {
    id: "new",
    name: "New",
    ariaKeyShortcuts: (value) =>
      value === "mac" ? "Meta+Alt+N" : "Control+Alt+N",
    label: (value) => (value === "mac" ? "⌘⌥N" : "Ctrl+Alt+N"),
    matches: (event, value) =>
      primary(event, value) && event.altKey && physical(event, "KeyN"),
  },
  save: {
    id: "save",
    name: "Save",
    ariaKeyShortcuts: (value) => (value === "mac" ? "Meta+S" : "Control+S"),
    label: (value) => (value === "mac" ? "⌘S" : "Ctrl+S"),
    matches: (event, value) =>
      primary(event, value) &&
      !event.altKey &&
      !event.shiftKey &&
      physical(event, "KeyS"),
  },
  "panel-toggle": {
    id: "panel-toggle",
    name: "Toggle project panel",
    ariaKeyShortcuts: () => "Alt+0",
    label: (value) => (value === "mac" ? "⌥0" : "Alt+0"),
    matches: (event) =>
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      physicalNumber(event, 0),
  },
  "browse-folders": {
    id: "browse-folders",
    name: "Browse folders",
    ariaKeyShortcuts: () => "Alt+1",
    label: (value) => (value === "mac" ? "⌥1" : "Alt+1"),
    matches: (event) =>
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      physicalNumber(event, 1),
  },
};

export const commandTooltip = (
  command: Command,
  value: Platform,
  disabledReason?: string,
) =>
  disabledReason
    ? `${command.name} — ${disabledReason} (${command.label(value)})`
    : `${command.name} (${command.label(value)})`;
