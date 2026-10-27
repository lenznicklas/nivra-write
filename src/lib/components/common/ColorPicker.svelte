<script lang="ts">
  let { label, onselect }: { label: string; onselect: (value: string) => void } = $props();
  const colors = [
    '#222222',
    '#596579',
    '#8b3945',
    '#bd6435',
    '#b48b24',
    '#398365',
    '#397c9b',
    '#5264ae',
    '#8755a0',
    '#ffffff',
    '#fff2a8',
    '#d6eadb',
  ];
</script>

<details class="color-picker">
  <summary title={label} aria-label={label}
    ><span class:highlight={label === 'Highlight'}>A</span><small>⌄</small></summary
  >
  <div class="color-popover">
    <strong>{label}</strong>
    <div class="swatches">
      {#each colors as color}<button
          style:background={color}
          title={color}
          aria-label={color}
          onclick={(e) => {
            onselect(color);
            e.currentTarget.closest('details')?.removeAttribute('open');
          }}
        ></button>{/each}
    </div>
    <label
      >Custom color <input
        type="color"
        aria-label={`Custom ${label}`}
        oninput={(e) => onselect(e.currentTarget.value)}
      /></label
    >
  </div>
</details>
