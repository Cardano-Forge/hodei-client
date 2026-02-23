import { type BridgeState, isBridgeState } from "./bridge";

export function sendCommand(element: Element, command: Command) {
  element.dispatchEvent(new CustomEvent("command", { detail: command }));
}

export function addCommandListener(
  element: Element,
  onCommand: (command: Command) => void,
  opts?: AddEventListenerOptions,
): () => void {
  const handler = (event: Event) => {
    const command = parseCommandEvent(event);
    if (command) {
      onCommand(command);
    }
  };

  element.addEventListener("command", handler, opts);

  return () => {
    element.removeEventListener("command", handler, opts);
  };
}

export function parseCommandEvent(event: Event): Command | undefined {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }

  return isCommand(event.detail) ? event.detail : undefined;
}

export type Command =
  | { sender: "wallet"; type: "disconnecting" }
  | { sender: "client"; type: "disconnected" }
  | { sender: "client"; type: "unlinked" }
  | { sender: "wallet"; type: "state_changed"; payload: BridgeState }
  | { sender: "client"; type: "dialog_closed" };

const commandTypes = new Set([
  "disconnecting",
  "disconnected",
  "unlinked",
  "dialog_closed",
]);

function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string") return false;
  if (commandTypes.has(v.type)) return true;
  return v.type === "state_changed" && isBridgeState(v.payload);
}
