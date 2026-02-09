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
</script>

{#if bridgeState}
  <div class="status">
    status: {bridgeState.status}
    {#if bridgeState.status === "pairing"}
      <div>PIN: {bridgeState.pin}</div>
    {/if}
  </div>
{/if}

<style>
  .status {
    position: fixed;
    top: 0;
    right: 0;
    padding: 1rem;
  }
</style>
