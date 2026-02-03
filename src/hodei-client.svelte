<svelte:options customElement="hodei-client" />

<script lang="ts">
  let count = $state(0);
  const increment = () => count++;
</script>

<button onclick={increment}>count is {count}</button>
