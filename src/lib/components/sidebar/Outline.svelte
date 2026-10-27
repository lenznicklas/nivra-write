<script lang="ts">
  export interface OutlineEntry {
    text: string;
    level: number;
    position: number;
  }
  let { entries, onnavigate }: { entries: OutlineEntry[]; onnavigate: (position: number) => void } =
    $props();
</script>

<aside class="outline">
  <div class="section-label">DOCUMENT OUTLINE</div>
  <div class="outline-intro">A little structure.<br />A clearer perspective.</div>
  {#if entries.length === 0}<p class="outline-empty">
      Your headings will appear here as your document takes shape.
    </p>{:else}<nav aria-label="Document outline">
      {#each entries as entry}<button
          style:padding-left={`${12 + (entry.level - 1) * 12}px`}
          onclick={() => onnavigate(entry.position)}
          ><span class="outline-dot"></span>{entry.text || 'Untitled heading'}</button
        >{/each}
    </nav>{/if}
  <div class="outline-footer">A space for your thoughts.</div>
</aside>
