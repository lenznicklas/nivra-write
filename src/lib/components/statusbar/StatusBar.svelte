<script lang="ts">
  import { Minus, Plus, PanelLeft, Check, LoaderCircle } from '@lucide/svelte';
  import IconButton from '../common/IconButton.svelte';
  let {
    words,
    characters,
    zoom,
    state,
    size = null,
    onzoom,
    onoutline,
  }: {
    words: number;
    characters: number;
    zoom: number;
    state: string;
    size?: number | null;
    onzoom: (v: number) => void;
    onoutline: () => void;
  } = $props();
</script>

<footer class="statusbar">
  <div>
    <IconButton icon={PanelLeft} label="Toggle document outline" onclick={onoutline} /><span
      >Continuous page</span
    ><span class="status-divider"></span><span>{words.toLocaleString()} words</span><span
      >{characters.toLocaleString()} characters</span
    >
  </div>
  <div>
    <span class="save-state" class:save-failed={state === 'Save failed'}
      >{#if state === 'Saved'}<Check size={13} />{:else if state === 'Saving…'}<LoaderCircle
          size={13}
        />{/if}{state}{#if size !== null}<span title="Last saved package size">
          · {(size / 1024).toFixed(0)} KB</span
        >{/if}</span
    ><span class="status-divider"></span><IconButton
      icon={Minus}
      label="Zoom out"
      onclick={() => onzoom(zoom - 10)}
    /><input
      aria-label="Document zoom"
      type="range"
      min="50"
      max="200"
      step="5"
      value={zoom}
      oninput={(e) => onzoom(Number(e.currentTarget.value))}
    /><IconButton icon={Plus} label="Zoom in" onclick={() => onzoom(zoom + 10)} /><button
      class="zoom-value"
      title="Reset zoom"
      aria-label="Reset zoom"
      onclick={() => onzoom(100)}>{zoom}%</button
    >
  </div>
</footer>
