<script lang="ts">
  import { menuNavigation } from '../common/menu-navigation';
  import type { EditorCommands, CommandId } from '../../editor/commands/commands';
  let {
    x,
    y,
    commands,
    onclose,
    onlink,
    onerror,
  }: {
    x: number;
    y: number;
    commands: EditorCommands;
    onclose: () => void;
    onlink: () => void;
    onerror: (e: unknown) => void;
  } = $props();
  let element: HTMLDivElement;
  const run = (id: CommandId) => {
    commands.run(id);
    onclose();
  };
  async function clipboard(action: 'copy' | 'cut' | 'paste') {
    try {
      const e = commands.editor;
      if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        e.chain().focus().insertContent({ type: 'text', text }).run();
      } else {
        await navigator.clipboard.writeText(
          e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, '\n'),
        );
        if (action === 'cut') e.chain().focus().deleteSelection().run();
      }
      onclose();
    } catch (e) {
      onerror(e);
      onclose();
    }
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (!element?.contains(e.target as Node)) onclose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
/>
<div
  class="context-menu"
  style:left={`${Math.min(x, window.innerWidth - 210)}px`}
  style:top={`${Math.max(8, Math.min(y, window.innerHeight - 410))}px`}
  role="menu"
  tabindex="-1"
  bind:this={element}
  use:menuNavigation={onclose}
>
  {#each ['cut', 'copy', 'paste'] as action}<button
      role="menuitem"
      onclick={() => clipboard(action as 'cut' | 'copy' | 'paste')}
      >{action[0].toUpperCase() + action.slice(1)}</button
    >{/each}
  <hr />
  <button role="menuitem" onclick={() => run('bold')}>Bold</button><button
    role="menuitem"
    onclick={() => run('italic')}>Italic</button
  ><button
    role="menuitem"
    onclick={() => {
      onclose();
      onlink();
    }}>Edit link…</button
  ><button role="menuitem" onclick={() => run('clear')}>Clear formatting</button
  >{#if commands.editor.isActive('table')}<hr />
    {#each [{ id: 'addRow', label: 'Add row below' }, { id: 'addColumn', label: 'Add column after' }, { id: 'deleteRow', label: 'Delete row' }, { id: 'deleteColumn', label: 'Delete column' }, { id: 'headerRow', label: 'Toggle header row' }, { id: 'deleteTable', label: 'Delete table' }] as action}<button
        role="menuitem"
        onclick={() => run(action.id as CommandId)}>{action.label}</button
      >{/each}{/if}
</div>
