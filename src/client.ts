import css from "./client.css?inline";
import template from "./client.html?raw";
import { addCommandListener, type Command, sendCommand } from "./command";

type ClientState =
  | { status: "disconnected" }
  | { status: "connected" }
  | { status: "pairing"; pin: string }
  | { status: "disconnecting"; shouldUnlink: boolean };

export class HodeiClient extends HTMLElement {
  private _state: ClientState = { status: "disconnected" };
  private _shadow: ShadowRoot;
  private _dialog: HTMLDialogElement;
  private _unsub: (() => void) | undefined;
  private _observer: MutationObserver | undefined;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._shadow.innerHTML = `<style>${css}</style>${template}`;

    const dialog = this._shadow.querySelector("dialog");
    if (dialog) {
      this._dialog = dialog;
    } else {
      throw new Error("dialog not found");
    }

    for (const event of [
      "pointerdown",
      "pointerup",
      "click",
      "mousedown",
      "mouseup",
    ] as const) {
      this.addEventListener(event, (e) => e.stopPropagation());
    }

    this._dialog.addEventListener("click", (e) => {
      if (e.target === this._dialog) {
        this._dialog.close("backdrop");
      }
    });

    this._dialog.addEventListener("close", () => {
      switch (this._state.status) {
        case "pairing":
          sendCommand(this, {
            sender: "client",
            type: "dialog_closed",
          });
          break;
        case "disconnecting":
          if (this._dialog.returnValue === "backdrop") {
            this._state = { status: "connected" };
          } else {
            sendCommand(this, {
              sender: "client",
              type: this._state.shouldUnlink ? "unlinked" : "disconnected",
            });
          }
          break;
      }
    });
  }

  connectedCallback() {
    this._unsub = addCommandListener(this, (command: Command) => {
      if (command.sender !== "wallet") {
        return;
      }
      switch (command.type) {
        case "state_changed":
          switch (command.payload.status) {
            case "paired":
              this._state = { status: "connected" };
              break;
            case "pairing":
              this._state = { status: "pairing", pin: command.payload.pin };
              break;
            default:
              this._state = { status: "disconnected" };
              break;
          }
          this._update();
          break;
        case "disconnecting":
          if (this._state.status === "connected") {
            this._state = { status: "disconnecting", shouldUnlink: false };
            this._update();
          }
          break;
      }
    });

    const parent = this.parentElement;
    if (parent) {
      this._observer = new MutationObserver(() => {
        if (parent.lastElementChild !== this) {
          parent.removeChild(this);
          parent.appendChild(this);
        }
      });
      this._observer.observe(parent, { childList: true });
    }

    this.dispatchEvent(new CustomEvent("mounted"));
  }

  disconnectedCallback() {
    this._unsub?.();
    this._observer?.disconnect();
    this.dispatchEvent(new CustomEvent("unmounted"));
  }

  private _cloneTemplate(id: string): DocumentFragment {
    const tmpl = this._shadow.querySelector<HTMLTemplateElement>(`#${id}`);
    return tmpl?.content.cloneNode(true) as DocumentFragment;
  }

  private _update() {
    const state = this._state;
    switch (state.status) {
      case "pairing": {
        const content = this._cloneTemplate(state.status);
        const pinEl = content.querySelector(".pin");
        if (pinEl) {
          pinEl.textContent = state.pin;
        }
        this._dialog.replaceChildren(content);
        if (!this._dialog.open) {
          this._dialog.showModal();
        }
        break;
      }
      case "disconnecting": {
        const content = this._cloneTemplate(state.status);
        this._dialog.replaceChildren(content);
        for (const btn of this._dialog.querySelectorAll<HTMLButtonElement>(
          "button",
        )) {
          btn.addEventListener("click", () => {
            state.shouldUnlink = btn.dataset.action === "unlink";
            this._dialog.close("disconnect");
          });
        }
        if (!this._dialog.open) {
          this._dialog.showModal();
        }
        break;
      }
      default: {
        if (this._dialog.open) {
          this._dialog.close("no-content");
        }
        break;
      }
    }
  }
}
