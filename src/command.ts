import * as z from "zod/mini";
import { bridgeStateSchema } from "./bridge";

export function sendCommand(element: Element, command: Command) {
  element.dispatchEvent(new CustomEvent("command", { detail: command }));
}

export function addCommandListener(
  element: Element,
  onCommand: (command: Command) => void,
): () => void {
  const handler = (event: Event) => {
    const command = parseCommandEvent(event);
    if (command) {
      onCommand(command);
    }
  };

  element.addEventListener("command", handler);

  return () => {
    element.removeEventListener("command", handler);
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

const stateChangedCommandSchema = z.object({
  type: z.enum(["state_changed"]),
  payload: bridgeStateSchema,
});

const commandSchema = z.discriminatedUnion("type", [stateChangedCommandSchema]);

export type Command = z.infer<typeof commandSchema>;
