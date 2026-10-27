<script lang="ts">
  import type { Component } from 'svelte';
  let {
    icon: Icon,
    label,
    onclick,
    active = false,
    disabled = false,
  }: {
    icon: Component<{ size?: number; strokeWidth?: number }>;
    label: string;
    onclick: () => void;
    active?: boolean;
    disabled?: boolean;
  } = $props();
</script>

<button
  class:active
  class="icon-button"
  title={label}
  aria-label={label}
  aria-pressed={active}
  {disabled}
  onmousedown={(e) => e.preventDefault()}
  {onclick}><Icon size={17} strokeWidth={1.7} /></button
>
