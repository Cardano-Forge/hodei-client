<svelte:options customElement="hodei-client" />

<script lang="ts">
  import type { BridgeState } from "./bridge";
  import { addCommandListener, type Command } from "./command";

  let bridgeState = $state<BridgeState>();

  function handleCommand(command: Command) {
    switch (command.type) {
      case "state_changed": {
        bridgeState = command.payload;
        break;
      }
      default: {
        console.error("unknown command", command);
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

{#if bridgeState?.status === "pairing"}
  <dialog open>PIN: {bridgeState.pin}</dialog>
{/if}

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
    position: fixed;
    top: 0;
    left: 0;
    background-color: orange;
    z-index: 9999;
  }
</style>
