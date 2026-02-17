import * as z from "zod/mini";
import { bridgeStateSchema } from "./bridge";

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

  const parsed = commandSchema.safeParse(event.detail);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

const disconnectingCommandSchema = z.object({
  type: z.enum(["disconnecting"]),
});

const disconnectedCommandSchema = z.object({
  type: z.enum(["disconnected"]),
});

const unlinkedCommandSchema = z.object({
  type: z.enum(["unlinked"]),
});

const stateChangedCommandSchema = z.object({
  type: z.enum(["state_changed"]),
  payload: bridgeStateSchema,
});

const dialogClosedCommandSchema = z.object({
  type: z.literal("dialog_closed"),
});

const commandSchema = z.discriminatedUnion("type", [
  disconnectingCommandSchema,
  disconnectedCommandSchema,
  unlinkedCommandSchema,
  stateChangedCommandSchema,
  dialogClosedCommandSchema,
]);

export type Command = z.infer<typeof commandSchema>;
