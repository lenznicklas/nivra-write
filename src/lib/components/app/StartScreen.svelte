<script lang="ts">
  import { FilePlus2, FolderOpen, FileText, Keyboard } from '@lucide/svelte';
  import type { RecentDocument } from '../../services/documents/recent';
  let {
    recents,
    onnew,
    onopen,
    onrecent,
    onremove,
  }: {
    recents: RecentDocument[];
    onnew: () => void;
    onopen: () => void;
    onrecent: (path: string) => void;
    onremove: (path: string) => void;
  } = $props();
  const modifier = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
</script>

<main class="start-screen">
  <div class="start-content">
    <div class="start-heading">
      <span class="eyebrow">WORKSPACE</span>
      <h1>Welcome to Nivra Writer</h1>
      <p class="start-description">Create a document or continue where you left off.</p>
    </div>
    <div class="start-columns">
      <div class="start-left">
        <h2 class="section-label">GET STARTED</h2>
        <div class="start-actions">
          <button class="new-document" onclick={onnew}
            ><FilePlus2 size={23} /><span
              ><strong>Blank document</strong><small>A fresh page, ready to write</small></span
            ><kbd>{modifier}+N</kbd></button
          ><button class="open-document" onclick={onopen}
            ><FolderOpen size={23} /><span
              ><strong>Open document</strong><small>Browse for a .nwr file</small></span
            ><kbd>{modifier}+O</kbd></button
          >
        </div>
        <div class="start-tip">
          <Keyboard size={17} /><span
            >Made for your keyboard<small>Use familiar shortcuts to stay in the flow.</small></span
          >
        </div>
      </div>
      <section class="start-recent" aria-label="Recent documents">
        <div class="recent-heading">
          <h2>Recent documents</h2>
          <span>Last opened</span>
        </div>
        {#if recents.length}<div class="recent-list">
            {#each recents as recent}<div
                class="recent-row"
                class:unavailable={recent.available === false}
              >
                <button disabled={recent.available === false} onclick={() => onrecent(recent.path)}
                  ><FileText size={20} /><span
                    ><strong
                      >{recent.title}{recent.available === false ? ' · Unavailable' : ''}</strong
                    ><small>{recent.path}</small></span
                  ><time
                    >{new Date(recent.lastOpened).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}</time
                  ></button
                ><button
                  class="remove-recent"
                  aria-label={`Remove ${recent.title} from recent documents`}
                  title="Remove from recent documents"
                  onclick={() => onremove(recent.path)}>×</button
                >
              </div>{/each}
          </div>{:else}<div class="empty-recents">
            <span class="empty-file"><FileText size={28} /></span><strong
              >No recent documents</strong
            ><span>Documents you open will appear here.</span><button
              class="secondary"
              onclick={onopen}>Browse files…</button
            >
          </div>{/if}
      </section>
    </div>
    <div class="start-note">
      <span class="local-dot"></span>Local by design. Your documents stay on this device.
    </div>
  </div>
</main>
