<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { extensions } from '../../editor/extensions';
  import { EditorCommands } from '../../editor/commands/commands';
  import type { WriterDocument } from '../../editor/document/model';
  import { pageLayout } from '../../services/layout/page-layout';
  let {
    document,
    assets,
    zoom,
    onready,
    onchange,
    onselection,
    oncontext,
  }: {
    document: WriterDocument;
    assets: import('../../editor/document/assets').AssetResolver;
    zoom: number;
    onready: (editor: Editor, commands: EditorCommands) => void;
    onchange: () => void;
    onselection: () => void;
    oncontext: (event: MouseEvent) => void;
  } = $props();
  let host: HTMLDivElement;
  const geometry = $derived(pageLayout.geometry(document.pageSettings));
  onMount(() => {
    const editor = new Editor({
      element: host,
      extensions: extensions(assets),
      content: document.content,
      enableContentCheck: true,
      editorProps: {
        attributes: {
          'aria-label': 'Document content',
          role: 'textbox',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
      },
      onUpdate: onchange,
      onSelectionUpdate: onselection,
      onTransaction: ({ transaction }) => {
        if (!transaction.docChanged) onselection();
      },
    });
    onready(editor, new EditorCommands(editor));
    return () => editor.destroy();
  });
</script>

<div class="workspace" id="workspace">
  <div class="page-stage" style:width={`${(geometry.width * zoom) / 100}px`}>
    <div class="page-ruler" aria-hidden="true">
      <span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span><span
        >12</span
      ><span>14</span><span>16</span>
    </div>
    <div
      class="paper"
      style:width={`${geometry.width}px`}
      style:min-height={`${geometry.minHeight}px`}
      style:padding={geometry.padding}
      style:zoom={zoom / 100}
      oncontextmenu={oncontext}
      role="presentation"
    >
      <div bind:this={host}></div>
    </div>
    <div class="paper-caption">
      {document.pageSettings.size} · {document.pageSettings.orientation} · Continuous canvas
    </div>
  </div>
</div>
