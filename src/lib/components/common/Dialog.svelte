<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let { title, children, onclose }: { title: string; children: Snippet; onclose: () => void } =
    $props();
  let element: HTMLDialogElement;
  onMount(() => {
    element.showModal();
  });
</script>

<dialog bind:this={element} oncancel={onclose} {onclose} aria-label={title}>
  <div class="dialog-heading">
    <h2>{title}</h2>
    <button class="icon-button" aria-label="Close dialog" onclick={onclose}>×</button>
  </div>
  {@render children()}
</dialog>
