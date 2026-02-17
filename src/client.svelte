<svelte:options customElement="hodei-client" />

<script lang="ts">
  import type { BridgeState } from "./bridge";
  import { addCommandListener, sendCommand, type Command } from "./command";

  let bridgeState = $state<BridgeState | { status: "disconnecting"; shouldUnlink: boolean }>();
  let dialogEl = $state<HTMLDialogElement>();

  $effect(() => {
    if (bridgeState?.status === "pairing" || bridgeState?.status === "disconnecting") {
      dialogEl?.showModal();
    } else if (dialogEl?.open) {
      dialogEl.close();
    }
  });

  function handleDialogClose() {
    switch (bridgeState?.status) {
      case "pairing": {
        sendCommand($host(), {
          type: "dialog_closed",
        });
        break;
      }
      case "disconnecting": {
        sendCommand($host(), {
          type: bridgeState.shouldUnlink ? "unlinked" : "disconnected",
        });
        break;
      }
    }
  }

  $effect(() => {
    dialogEl?.addEventListener("close", handleDialogClose);
    return () => dialogEl?.removeEventListener("close", handleDialogClose);
  });

  function handleCommand(command: Command) {
    switch (command.type) {
      case "state_changed": {
        bridgeState = command.payload;
        break;
      }
      case "disconnecting": {
        bridgeState = { status: "disconnecting", shouldUnlink: false };
        break;
      }
    }
  }

  $effect(() => {
    const unsub = addCommandListener($host(), handleCommand);
    return () => unsub();
  });

  $effect(() => {
    $host().dispatchEvent(new CustomEvent("mounted"));
    return () => $host().dispatchEvent(new CustomEvent("unmounted"));
  });

  $effect(() => {
    const parent = $host().parentElement;
    if (!parent) {
      return;
    }

    // Ensures that the host element is always the last child of its parent
    // to avoid z-index issues
    const observer = new MutationObserver(() => {
      if (parent.lastElementChild !== $host()) {
        parent.removeChild($host());
        parent.appendChild($host());
      }
    });

    observer.observe(parent, { childList: true });
    return () => observer.disconnect();
  });
</script>

<dialog
  bind:this={dialogEl}
  onclick={(event) => {
    if (event.target === dialogEl) {
      dialogEl.close();
    }
  }}
>
  <article>
    <img src="https://ik.imagekit.io/pizzli/cforge/logo.png" alt="hodei" />
    {#if bridgeState?.status === "pairing"}
      <h1>Pairing</h1>
      <h2>{bridgeState.pin}</h2>
      <p>Enter this code on the Hodei app to pair your wallet</p>
    {:else if bridgeState?.status === "disconnecting"}
      <h1>Disconnecting</h1>
      <p>Do you want to unlink your wallet from the Hodei app or disconnect only?</p>
      <footer>
        <button
          onclick={() => {
            if (bridgeState?.status === "disconnecting") {
              bridgeState.shouldUnlink = true;
            }
            dialogEl?.close();
          }}
        >
          Unlink
        </button>
        <button
          onclick={() => {
            if (bridgeState?.status === "disconnecting") {
              bridgeState.shouldUnlink = false;
            }
            dialogEl?.close();
          }}
        >
          Disconnect only
        </button>
      </footer>
    {:else}
      <h1>Hodei client</h1>
      <p>This is a Hodei client for your wallet</p>
      <button onclick={() => dialogEl?.close()}>Close</button>
    {/if}
  </article>
</dialog>

{#if bridgeState}
  <div class="status">
    status: {bridgeState.status}
  </div>
{/if}

<style>
  * {
    box-sizing: border-box;
  }

  :host {
    font-family: "Roboto", Arial, Helvetica, sans-serif;
  }

  .status {
    position: fixed;
    bottom: 0;
    right: 0;
    padding: 24px;
  }

  dialog {
    width: 100%;
    max-width: 300px;
    outline: none;
    border: none;
    padding: 24px;
    background: transparent;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.32);
  }

  article {
    padding: 24px;
    border-radius: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    overflow: hidden;
    text-align: center;
    background: linear-gradient(to bottom right, #ebdee8, #fff7fa);
    color: #1e191e;
  }

  @media (prefers-color-scheme: dark) {
    article {
      background: linear-gradient(to bottom right, #362a36, #181215);
      color: #eadfe6;
    }
  }

  h1 {
    margin: 12px 0 16px 0;
    font-size: 20px;
    font-weight: 400;
  }

  p {
    margin: 24px 0 0 0;
    font-size: 14px;
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.2em;
  }

  img {
    width: 75;
    height: 75px;
  }
</style>
