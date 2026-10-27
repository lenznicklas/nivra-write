<script lang="ts">
  import {
    Undo2,
    Redo2,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    List,
    ListOrdered,
    IndentIncrease,
    IndentDecrease,
    RemoveFormatting,
    Image,
    Table,
    Minus,
    Link,
    Quote,
    Type,
    Plus,
  } from '@lucide/svelte';
  import IconButton from '../common/IconButton.svelte';
  import ColorPicker from '../common/ColorPicker.svelte';
  import type { EditorCommands, CommandId } from '../../editor/commands/commands';
  let {
    commands,
    revision,
    tab,
    onimage,
    onlink,
    onlayout,
  }: {
    commands: EditorCommands;
    revision: number;
    tab: string;
    onimage: () => void;
    onlink: () => void;
    onlayout: () => void;
  } = $props();
  const view = $derived.by(() => {
    void revision;
    const e = commands.editor;
    return {
      active: Object.fromEntries(
        ['bold', 'italic', 'underline', 'strike', 'blockquote', 'bulletList', 'orderedList'].map(
          (name) => [name, e.isActive(name)],
        ),
      ),
      align: e.getAttributes(e.isActive('heading') ? 'heading' : 'paragraph').textAlign,
      level: e.isActive('heading') ? e.getAttributes('heading').level : 0,
      font: e.getAttributes('textStyle').fontFamily || 'Georgia',
      size: parseFloat(String(e.getAttributes('textStyle').fontSize || '12')),
      undo: e.can().undo(),
      redo: e.can().redo(),
    };
  });
  const fontSize = $derived(view.size);
  const run = (id: CommandId) => commands.run(id);
</script>

<div class="ribbon" aria-label={`${tab} toolbar`} role="toolbar">
  {#if tab === 'Home'}
    <div class="ribbon-group narrow">
      <div class="controls">
        <IconButton
          icon={Undo2}
          label="Undo"
          onclick={() => run('undo')}
          disabled={!view.undo}
        /><IconButton icon={Redo2} label="Redo" onclick={() => run('redo')} disabled={!view.redo} />
      </div>
      <span class="group-caption">History</span>
    </div>
    <div class="ribbon-group">
      <div class="controls">
        <select
          aria-label="Paragraph style"
          value={view.level}
          onchange={(e) => commands.style(Number(e.currentTarget.value))}
          ><option value={0}>Normal text</option>{#each [1, 2, 3, 4, 5, 6] as level}<option
              value={level}>Heading {level}</option
            >{/each}</select
        ><IconButton
          icon={Quote}
          label="Block quote"
          active={view.active.blockquote}
          onclick={() => run('blockquote')}
        />
      </div>
      <span class="group-caption">Styles</span>
    </div>
    <div class="ribbon-group font-group">
      <div class="controls">
        <select
          class="font-select"
          aria-label="Font family"
          value={view.font}
          onchange={(e) => commands.font(e.currentTarget.value)}
          >{#each ['Georgia', 'Arial', 'Calibri', 'Times New Roman', 'Verdana', 'Courier New', 'Inter', 'system-ui'] as font}<option
              style:font-family={font}>{font}</option
            >{/each}</select
        ><input
          class="font-size"
          aria-label="Font size"
          type="number"
          min="6"
          max="144"
          value={fontSize}
          onchange={(e) => commands.size(Number(e.currentTarget.value))}
        /><IconButton
          icon={Minus}
          label="Decrease font size"
          onclick={() => commands.size(fontSize - 1)}
        /><IconButton
          icon={Plus}
          label="Increase font size"
          onclick={() => commands.size(fontSize + 1)}
        />
      </div>
      <div class="controls formatting">
        {#each [{ id: 'bold', icon: Bold, label: 'Bold · Ctrl+B' }, { id: 'italic', icon: Italic, label: 'Italic · Ctrl+I' }, { id: 'underline', icon: Underline, label: 'Underline · Ctrl+U' }, { id: 'strike', icon: Strikethrough, label: 'Strikethrough' }] as item}<IconButton
            icon={item.icon}
            label={item.label}
            active={view.active[item.id]}
            onclick={() => run(item.id as CommandId)}
          />{/each}<span class="mini-separator"></span><ColorPicker
          label="Text color"
          onselect={(v) => commands.color(v)}
        /><ColorPicker label="Highlight" onselect={(v) => commands.highlight(v)} /><IconButton
          icon={RemoveFormatting}
          label="Clear formatting"
          onclick={() => run('clear')}
        />
      </div>
      <span class="group-caption">Font</span>
    </div>
    <div class="ribbon-group">
      <div class="controls">
        {#each [{ id: 'left', icon: AlignLeft }, { id: 'center', icon: AlignCenter }, { id: 'right', icon: AlignRight }, { id: 'justify', icon: AlignJustify }] as a}<IconButton
            icon={a.icon}
            label={`Align ${a.id}`}
            active={view.align === a.id}
            onclick={() => commands.align(a.id as 'left' | 'center' | 'right' | 'justify')}
          />{/each}
      </div>
      <div class="controls">
        <IconButton
          icon={List}
          label="Bullet list"
          active={view.active.bulletList}
          onclick={() => run('bulletList')}
        /><IconButton
          icon={ListOrdered}
          label="Numbered list"
          active={view.active.orderedList}
          onclick={() => run('orderedList')}
        /><IconButton
          icon={IndentDecrease}
          label="Outdent"
          onclick={() => run('outdent')}
        /><IconButton icon={IndentIncrease} label="Indent" onclick={() => run('indent')} /><select
          class="spacing"
          aria-label="Line spacing"
          onchange={(e) => commands.spacing(e.currentTarget.value)}
          ><option value="1.65">1.65</option><option value="1">1.0</option><option value="1.15"
            >1.15</option
          ><option value="1.5">1.5</option><option value="2">2.0</option></select
        >
      </div>
      <span class="group-caption">Paragraph</span>
    </div>
  {:else if tab === 'Insert'}
    <div class="insert-controls">
      <button onclick={onimage}><Image size={22} />Image</button><button
        onclick={() => run('table')}><Table size={22} />Table</button
      ><button onclick={onlink}><Link size={22} />Link</button><button onclick={() => run('rule')}
        ><Minus size={22} />Divider</button
      ><button onclick={() => run('pageBreak')}><Type size={22} />Page break</button><select
        aria-label="Insert special character"
        value=""
        onchange={(e) => {
          commands.character(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
        ><option value="" disabled>Symbol</option
        >{#each ['©', '®', '™', '—', '…', '§', '±', '€', '£', '•'] as symbol}<option
            >{symbol}</option
          >{/each}</select
      >
    </div>
  {:else if tab === 'Layout'}<div class="layout-summary">
      <strong>Page setup</strong><span>Continuous document · visual page layout</span><button
        class="secondary"
        onclick={onlayout}>Page size & orientation</button
      >
    </div>
  {:else}<div class="layout-summary">
      <strong>Review your writing</strong><span
        >Use the outline to navigate. Word and character counts update as you write.</span
      ><span class="muted">Comments and track changes are planned for a future release.</span>
    </div>{/if}
</div>
