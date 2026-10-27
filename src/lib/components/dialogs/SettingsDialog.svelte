<script lang="ts">
  import { untrack } from 'svelte';
  import Dialog from '../common/Dialog.svelte';
  import type { Settings } from '../../services/settings/settings';
  let {
    settings,
    onapply,
    onclose,
  }: { settings: Settings; onapply: (settings: Settings) => void; onclose: () => void } = $props();
  let draft = $state<Settings>(untrack(() => ({ ...settings })));
</script>

<Dialog title="Settings" {onclose}
  ><div class="settings-body">
    <h3>Appearance</h3>
    <label
      >Theme<select aria-label="Theme" bind:value={draft.theme}
        ><option value="system">Follow system</option><option value="light">Light</option><option
          value="dark">Dark</option
        ></select
      ></label
    >
    <h3>Editor</h3>
    <label
      >Default zoom<input
        type="number"
        min="50"
        max="200"
        step="10"
        bind:value={draft.defaultZoom}
      /></label
    ><label>Show document outline<input type="checkbox" bind:checked={draft.outline} /></label
    ><label
      >Default page size<select bind:value={draft.pageSize}
        ><option>A4</option><option>Letter</option></select
      ></label
    >
    <h3>Files & recovery</h3>
    <label>Save recovery snapshots<input type="checkbox" bind:checked={draft.autosave} /></label
    ><label
      >Snapshot interval (seconds)<input
        type="number"
        min="5"
        max="300"
        bind:value={draft.autosaveInterval}
      /></label
    >
    <p class="muted">
      Recovery snapshots are separate from your saved files. Use Save to update the original
      document.
    </p>
  </div>
  <div class="dialog-actions">
    <button class="secondary" onclick={onclose}>Cancel</button><button
      class="primary"
      onclick={() => onapply(draft)}>Save settings</button
    >
  </div></Dialog
>
