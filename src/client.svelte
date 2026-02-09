<svelte:options customElement="hodei-client" />

<script lang="ts">
  import type { BridgeState } from "./bridge";
  import { addCommandListener, sendCommand, type Command } from "./command";

  let bridgeState = $state<BridgeState>();
  let dialogEl = $state<HTMLDialogElement>();

  $effect(() => {
    if (bridgeState?.status === "pairing") {
      dialogEl?.showModal();
    } else if (dialogEl?.open) {
      dialogEl.close();
    }
  });

  function handleDialogClose() {
    sendCommand($host(), { type: "dialog_closed" });
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

<dialog bind:this={dialogEl}>
  <article>
    <header>PIN</header>
    {#if bridgeState?.status === "pairing"}
      {bridgeState.pin}
    {/if}
  </article>
</dialog>

{#if bridgeState}
  <div class="status">
    status: {bridgeState.status}
  </div>
{/if}

<style>
  .status {
    position: fixed;
    bottom: 0;
    right: 0;
    padding: 1rem;
  }

  dialog {
    background: white;
    padding: 1rem;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
</style>
