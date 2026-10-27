<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { FileText, Settings, PanelLeft, Save } from '@lucide/svelte';
  import IconButton from './lib/components/common/IconButton.svelte';
  import Dialog from './lib/components/common/Dialog.svelte';
  import StartScreen from './lib/components/app/StartScreen.svelte';
  import Ribbon from './lib/components/ribbon/Ribbon.svelte';
  import EditorCanvas from './lib/components/editor/EditorCanvas.svelte';
  import Outline from './lib/components/sidebar/Outline.svelte';
  import StatusBar from './lib/components/statusbar/StatusBar.svelte';
  import SettingsDialog from './lib/components/dialogs/SettingsDialog.svelte';
  import ContextMenu from './lib/components/menus/ContextMenu.svelte';
  import FileMenu from './lib/components/menus/FileMenu.svelte';
  import { DocumentSession } from './lib/stores/document.svelte';
  import { RecentDocuments } from './lib/stores/recent.svelte';
  import { settingsStore, uiStore } from './lib/stores/application';
  import {
    loadSettings,
    saveSettings,
    type Settings as AppSettings,
  } from './lib/services/settings/settings';
  import { native } from './lib/services/native/bridge';
  import { recovery, type RecoveryCandidate } from './lib/services/autosave/recovery';
  import { exportDocument } from './lib/services/export/export';
  const recentDocuments = new RecentDocuments();
  const session = new DocumentSession(recentDocuments);
  let tab = $state('Home');

  let settingsOpen = $state(false);
  let about = $state(false);
  let pageSetup = $state(false);
  let linkOpen = $state(false);
  let linkValue = $state('');
  let pending = $state<(() => Promise<void> | void) | null>(null);
  let snapshots = $state<RecoveryCandidate[]>([]);
  let context = $state<{ x: number; y: number } | null>(null);
  let ready = $state(false);
  const protect = async (action: () => Promise<void> | void) => {
    if (session.saving || session.loading) return;
    if (session.dirty) {
      pending = action;
      return;
    }
    await action();
  };
  const attempt = async (action: () => Promise<unknown> | unknown) => {
    try {
      await action();
    } catch (e) {
      session.fail(e);
    }
  };
  const newDocument = () =>
    attempt(() => protect(() => session.newDocument($settingsStore.pageSize)));
  const openDocument = (path?: string) => attempt(() => protect(() => session.open(path)));
  const closeDocument = () =>
    attempt(() =>
      protect(async () => {
        session.close();
        await recentDocuments.refreshAvailability();
      }),
    );
  const openLink = () => {
    linkValue = String(session.editor?.getAttributes('link').href || '');
    linkOpen = true;
  };
  async function applySettings(settings: AppSettings) {
    await attempt(async () => {
      await saveSettings(settings);
      settingsStore.set(settings);
      uiStore.set({ outline: settings.outline, zoom: settings.defaultZoom });
      settingsOpen = false;
    });
  }
  async function resolvePending(save: boolean) {
    const action = pending;
    if (!action) return;
    if (save && !(await session.save())) return;
    await attempt(async () => {
      await session.discardRecovery();
      pending = null;
      await action();
    });
  }
  function keydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (['s', 'o', 'n'].includes(key)) {
      e.preventDefault();
      if (document.querySelector('dialog[open]')) return;
      if (key === 's') void session.save(e.shiftKey);
      if (key === 'o') void openDocument();
      if (key === 'n') void newDocument();
    }
    if (key === 'k' && session.editor && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      openLink();
    }
  }
  function setZoom(value: number) {
    uiStore.update((s) => ({ ...s, zoom: Math.min(200, Math.max(50, value)) }));
  }
  $effect(() => {
    document.documentElement.dataset.theme = $settingsStore.theme;
  });
  $effect(() => {
    const title = `${session.dirty ? '• ' : ''}${session.document?.metadata.title || 'Nivra Writer'}${session.document ? ' — Nivra Writer' : ''}`;
    document.title = title;
    if (native) void getCurrentWindow().setTitle(title).catch(session.fail);
  });
  $effect(() => {
    session.configureAutosave(ready && $settingsStore.autosave, $settingsStore.autosaveInterval);
  });
  onMount(() => {
    let unlisten: (() => void) | undefined;
    let dropUnlisten: (() => void) | undefined;
    void attempt(async () => {
      if (native) {
        unlisten = await getCurrentWindow().onCloseRequested((e) => {
          e.preventDefault();
          void attempt(() =>
            protect(async () => {
              await session.discardRecovery();
              await getCurrentWindow().destroy();
            }),
          );
        });
        dropUnlisten = await getCurrentWindow().onDragDropEvent((e) => {
          if (e.payload.type === 'drop') {
            const paths = e.payload.paths;
            const document = paths.find((path) => /\.nwr$/i.test(path));
            if (document) {
              void openDocument(document);
              return;
            }
            if (session.document)
              void attempt(async () => {
                for (const path of paths.filter((path) => /\.(png|jpe?g|webp)$/i.test(path)))
                  await session.insertImage(path);
              });
          }
        });
      }
      const initialization = await Promise.allSettled([
        loadSettings(),
        recentDocuments.load(),
        recovery.list(),
      ]);
      const issues: string[] = [];
      const [settingsResult, recentResult, recoveryResult] = initialization;
      if (settingsResult.status === 'fulfilled') {
        settingsStore.set(settingsResult.value);
        uiStore.set({
          outline: settingsResult.value.outline,
          zoom: settingsResult.value.defaultZoom,
        });
      } else issues.push(`Settings could not be loaded: ${String(settingsResult.reason)}`);
      if (recentResult.status === 'rejected')
        issues.push(`Recent documents could not be loaded: ${String(recentResult.reason)}`);
      if (recoveryResult.status === 'fulfilled') {
        snapshots = recoveryResult.value.snapshots;
        issues.push(...recoveryResult.value.issues);
      } else issues.push(`Recovery data could not be loaded: ${String(recoveryResult.reason)}`);
      ready = true;
      if (issues.length) session.fail(new Error(issues.join('\n')));
    });
    return () => {
      unlisten?.();
      dropUnlisten?.();
      session.dispose();
    };
  });
</script>

<svelte:window onkeydown={keydown} />
<div class="app-shell">
  <header class="appbar">
    <button class="brand" title="Start screen" onclick={closeDocument}
      ><span class="brand-mark">N</span><span>Nivra<span class="brand-light"> Writer</span></span
      ></button
    >
    <div class="title-center">
      {#if session.document}<FileText size={14} /><span>{session.document.metadata.title}</span
        >{#if session.dirty}<span class="dirty-dot" title="Unsaved changes"></span>{/if}{:else}<span
          class="muted">A clear space to write.</span
        >{/if}
    </div>
    <div class="appbar-actions">
      {#if session.document}<IconButton
          icon={Save}
          label="Save document · Ctrl+S"
          onclick={() => void session.save()}
          disabled={session.saving}
        />{/if}<IconButton
        icon={Settings}
        label="Settings"
        onclick={() => (settingsOpen = true)}
      /><span class="version-tag">0.2</span>
    </div>
  </header>
  <div class="tabbar">
    <FileMenu
      hasDocument={!!session.document}
      saving={session.saving}
      onnew={newDocument}
      onopen={() => void openDocument()}
      onsave={(as) => void session.save(as)}
      onexport={(format) =>
        void attempt(() =>
          exportDocument(
            format,
            session.document!.metadata.title,
            session.editor!.getHTML(),
            session.editor!.getText(),
            session.assets.sessionId,
          ),
        )}
      onclose={closeDocument}
      onsettings={() => (settingsOpen = true)}
      onabout={() => (about = true)}
    />
    {#each ['Home', 'Insert', 'Layout', 'Review'] as item}<button
        class:tab-active={tab === item}
        disabled={!session.document}
        onclick={() => (tab = item)}>{item}</button
      >{/each}
    <div class="tabbar-end">
      {#if session.document}<button
          title="Toggle outline"
          onclick={() => uiStore.update((s) => ({ ...s, outline: !s.outline }))}
          ><PanelLeft size={15} /><span>Outline</span></button
        >{:else}<span>OFFLINE & READY</span>{/if}
    </div>
  </div>
  {#if session.document}
    {#if session.commands}<Ribbon
        commands={session.commands}
        revision={session.revision}
        {tab}
        onimage={() => void attempt(() => session.insertImage())}
        onlink={openLink}
        onlayout={() => (pageSetup = true)}
      />{:else}<div class="ribbon"></div>{/if}
    <main class="editor-main">
      {#if $uiStore.outline}<Outline
          entries={session.outline}
          onnavigate={(position) => session.navigate(position)}
        />{/if}{#key session.epoch}<EditorCanvas
          document={session.document}
          assets={session.assets}
          zoom={$uiStore.zoom}
          onready={session.attach}
          onchange={session.changed}
          onselection={session.selection}
          oncontext={(e) => {
            e.preventDefault();
            context = { x: e.clientX, y: e.clientY };
          }}
        />{/key}
    </main>
    <StatusBar
      words={session.words}
      characters={session.characters}
      zoom={$uiStore.zoom}
      state={session.state}
      size={session.packagedSize}
      onzoom={setZoom}
      onoutline={() => uiStore.update((s) => ({ ...s, outline: !s.outline }))}
    />
  {:else}<StartScreen
      recents={recentDocuments.items}
      onnew={newDocument}
      onopen={() => void openDocument()}
      onrecent={(path) => void openDocument(path)}
      onremove={(path) => void attempt(() => recentDocuments.remove(path))}
    />
    <footer class="start-status">
      <span><span class="local-dot"></span> All systems ready</span><span
        >Nivra Writer · A thoughtful place to write</span
      >
    </footer>{/if}
</div>
{#if context && session.commands}<ContextMenu
    x={context.x}
    y={context.y}
    commands={session.commands}
    onclose={() => (context = null)}
    onlink={openLink}
    onerror={session.fail}
  />{/if}
{#if settingsOpen}<SettingsDialog
    settings={$settingsStore}
    onapply={applySettings}
    onclose={() => (settingsOpen = false)}
  />{/if}
{#if session.error}<Dialog
    title="Something needs your attention"
    onclose={() => (session.error = '')}
    ><p class="dialog-copy">{session.error}</p>
    <div class="dialog-actions">
      <button class="primary" onclick={() => (session.error = '')}>Got it</button>
    </div></Dialog
  >{/if}
{#if pending}<Dialog title="Save your changes?" onclose={() => (pending = null)}
    ><p class="dialog-copy">
      Your changes to “{session.document?.metadata.title}” haven’t been saved.
    </p>
    <div class="dialog-actions">
      <button class="danger-text" onclick={() => void resolvePending(false)}>Discard changes</button
      ><button class="secondary" onclick={() => (pending = null)}>Cancel</button><button
        class="primary"
        onclick={() => void resolvePending(true)}>Save changes</button
      >
    </div></Dialog
  >{/if}
{#if linkOpen}<Dialog title="Edit link" onclose={() => (linkOpen = false)}
    ><form
      onsubmit={(e) => {
        e.preventDefault();
        void attempt(() => {
          session.commands?.link(linkValue);
          linkOpen = false;
        });
      }}
    >
      <label class="field-label"
        >Web or email address<input
          type="text"
          placeholder="https://example.com"
          bind:value={linkValue}
        /></label
      >
      <p class="dialog-copy muted">Leave empty to remove the link.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary" onclick={() => (linkOpen = false)}>Cancel</button
        ><button class="primary">Apply link</button>
      </div>
    </form></Dialog
  >{/if}
{#if pageSetup && session.document}<Dialog title="Page setup" onclose={() => (pageSetup = false)}
    ><div class="settings-body">
      <label
        >Page size<select bind:value={session.document.pageSettings.size} onchange={session.changed}
          ><option>A4</option><option>Letter</option></select
        ></label
      ><label
        >Orientation<select
          bind:value={session.document.pageSettings.orientation}
          onchange={session.changed}
          ><option value="portrait">Portrait</option><option value="landscape">Landscape</option
          ></select
        ></label
      >{#each ['top', 'right', 'bottom', 'left'] as side}<label
          >{side[0].toUpperCase() + side.slice(1)} margin (mm)<input
            type="number"
            min="0"
            max="70"
            value={session.document.pageSettings.margins[
              side as 'top' | 'right' | 'bottom' | 'left'
            ]}
            onchange={(e) => {
              if (session.document) {
                session.document.pageSettings.margins[side as 'top' | 'right' | 'bottom' | 'left'] =
                  Math.max(0, Math.min(70, Number(e.currentTarget.value)));
                session.changed();
              }
            }}
          /></label
        >{/each}
    </div>
    <div class="dialog-actions">
      <button class="primary" onclick={() => (pageSetup = false)}>Done</button>
    </div></Dialog
  >{/if}
{#if snapshots.length}<Dialog
    title="Welcome back. Recover your work?"
    onclose={() => (snapshots = [])}
    ><p class="dialog-copy">Recovery snapshots were found from a previous session.</p>
    <div class="recovery-list">
      {#each snapshots as snapshot}<div>
          <span
            ><strong>{snapshot.title}</strong><small
              >{new Date(snapshot.savedAt).toLocaleString()} · Revision {snapshot.editRevision}{snapshot.path &&
              !snapshot.originalExists
                ? ' · Original unavailable'
                : ''}</small
            ></span
          ><button
            class="secondary"
            onclick={() =>
              void attempt(() =>
                protect(async () => {
                  snapshots = [];
                  await session.restore(snapshot);
                }),
              )}>Recover</button
          ><button
            class="danger-text"
            onclick={() =>
              void attempt(async () => {
                await recovery.remove(snapshot.recoveryId);
                snapshots = snapshots.filter((s) => s !== snapshot);
              })}>Discard</button
          >
        </div>{/each}
    </div></Dialog
  >{/if}
{#if about}<Dialog title="Nivra Writer" onclose={() => (about = false)}
    ><p class="dialog-copy">
      Version 0.2.0<br /><br />A thoughtful, local-first space for your words.<br />Built with
      Tauri, Svelte, and Tiptap.
    </p>
    <div class="dialog-actions">
      <button class="primary" onclick={() => (about = false)}>Back to writing</button>
    </div></Dialog
  >{/if}
