<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { menuNavigation } from '../common/menu-navigation';
  let {
    hasDocument,
    saving,
    onnew,
    onopen,
    onsave,
    onexport,
    onclose,
    onsettings,
    onabout,
  }: {
    hasDocument: boolean;
    saving: boolean;
    onnew: () => void;
    onopen: () => void;
    onsave: (as: boolean) => void;
    onexport: (format: 'html' | 'txt') => void;
    onclose: () => void;
    onsettings: () => void;
    onabout: () => void;
  } = $props();
  let open = $state(false);
  let wrapper: HTMLDivElement;
  const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  function act(action: () => void) {
    open = false;
    action();
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (!wrapper?.contains(e.target as Node)) open = false;
  }}
/>
<div class="file-menu-wrap" bind:this={wrapper}>
  <button
    class:tab-active={open}
    class="file-tab"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}>File<ChevronDown size={12} /></button
  >{#if open}<div class="file-menu" role="menu" use:menuNavigation={() => (open = false)}>
      <button role="menuitem" onclick={() => act(onnew)}>New document<kbd>{mod}N</kbd></button
      ><button role="menuitem" onclick={() => act(onopen)}>Open…<kbd>{mod}O</kbd></button
      >{#if hasDocument}<hr />
        <button disabled={saving} role="menuitem" onclick={() => act(() => onsave(false))}
          >Save<kbd>{mod}S</kbd></button
        ><button disabled={saving} role="menuitem" onclick={() => act(() => onsave(true))}
          >Save as…<kbd>{mod}Shift+S</kbd></button
        >
        <hr />
        <button role="menuitem" onclick={() => act(() => onexport('html'))}>Export HTML…</button
        ><button role="menuitem" onclick={() => act(() => onexport('txt'))}
          >Export plain text…</button
        ><button role="menuitem" onclick={() => act(onclose)}>Close document</button>{/if}
      <hr />
      <button role="menuitem" onclick={() => act(onsettings)}>Settings</button><button
        role="menuitem"
        onclick={() => act(onabout)}>About Nivra Writer</button
      >
    </div>{/if}
</div>
