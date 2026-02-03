<svelte:options customElement="hodei-client" />

<script lang="ts">
  import { addCommandListener, type Command } from "./command";

  let count = $state(0);

  function increment() {
    count++;
  }

  function handleCommand(command: Command) {
    console.log("command", command);
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

<button onclick={increment}>count is {count}</button>
