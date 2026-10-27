import type { Editor } from '@tiptap/core';
import type { EditorCommands } from '../editor/commands/commands';
import { createDocument, deserialize, type WriterDocument } from '../editor/document/model';
import {
  repository,
  chooseOpen,
  chooseSave,
  type LoadedDocument,
} from '../services/documents/repository';
import {
  recovery,
  type RecoverySnapshot,
  type RecoveryCandidate,
} from '../services/autosave/recovery';
import { AssetManager } from '../services/documents/assets';
import type { RecentDocuments } from './recent.svelte';
import { textCounts, errorMessage } from '../utils/text';
import { validateEditorDocument } from '../editor/document/validate';
import type { OutlineEntry } from '../components/sidebar/Outline.svelte';
export class DocumentSession {
  constructor(private readonly recentDocuments: RecentDocuments) {}
  document = $state<WriterDocument | null>(null);
  path = $state<string | null>(null);
  saving = $state(false);
  loading = $state(false);
  saveFailed = $state(false);
  editRevision = $state(0);
  lastSavedRevision = $state(0);
  savingRevision = $state<number | null>(null);
  revision = $state(0);
  words = $state(0);
  characters = $state(0);
  outline = $state<OutlineEntry[]>([]);
  error = $state('');
  packagedSize = $state<number | null>(null);
  editor: Editor | null = null;
  commands = $state.raw<EditorCommands | null>(null);
  assets = $state.raw(new AssetManager());
  epoch = $state(0);
  private recoveryId: string = crypto.randomUUID();
  private recoveredRevision = -1;
  private lastRecoveryAt = Date.now();
  private recoveryRetryAfter = 0;
  private statsTimer: ReturnType<typeof setTimeout> | undefined;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryWrite: Promise<void> | null = null;
  private autosaveEnabled = true;
  private autosaveInterval = 15;
  get dirty() {
    return this.editRevision !== this.lastSavedRevision;
  }
  get state() {
    return this.saving
      ? 'Saving…'
      : this.saveFailed
        ? 'Save failed'
        : this.dirty
          ? 'Unsaved'
          : this.path
            ? 'Saved'
            : 'New document';
  }
  fail = (error: unknown) => {
    this.error = errorMessage(error);
  };
  attach = (editor: Editor, commands: EditorCommands) => {
    this.editor = editor;
    this.commands = commands;
    this.updateStats();
    editor.commands.focus('start', { scrollIntoView: false });
    if (this.dirty) this.scheduleRecovery();
  };
  selection = () => {
    this.revision++;
  };
  changed = () => {
    this.editRevision++;
    this.revision++;
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => this.updateStats(), 250);
    this.scheduleRecovery();
  };
  configureAutosave(enabled: boolean, interval: number) {
    this.autosaveEnabled = enabled;
    this.autosaveInterval = interval;
    this.scheduleRecovery();
  }
  private scheduleRecovery() {
    clearTimeout(this.autosaveTimer);
    if (this.autosaveEnabled && this.dirty && this.recoveredRevision !== this.editRevision)
      this.autosaveTimer = setTimeout(
        () => void this.autosave().catch(this.fail),
        Math.max(
          this.recoveryRetryAfter - Date.now(),
          Math.min(
            this.autosaveInterval * 1000,
            Math.max(0, 60_000 - (Date.now() - this.lastRecoveryAt)),
          ),
        ),
      );
  }
  updateStats() {
    if (!this.editor) return;
    const counts = textCounts(this.editor.getText({ blockSeparator: '\n' }));
    this.words = counts.words;
    this.characters = counts.characters;
    const headings: OutlineEntry[] = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading')
        headings.push({ text: node.textContent, level: Number(node.attrs.level), position: pos });
    });
    this.outline = headings;
  }
  snapshot(): WriterDocument {
    if (!this.document || !this.editor) throw new Error('No open document.');
    const content = this.editor.getJSON();
    return {
      formatVersion: 2,
      pageSettings: $state.snapshot(this.document.pageSettings),
      metadata: {
        ...$state.snapshot(this.document.metadata),
        modifiedAt: new Date().toISOString(),
      },
      assets: this.assets.cleanupUnusedAssets(content),
      content,
    };
  }
  load(document: WriterDocument, path: string | null, dirty = false, loaded?: LoadedDocument) {
    const validated = validateEditorDocument(document);
    const previous = this.assets;
    this.assets = new AssetManager(loaded?.sessionId ?? null, validated.assets);
    void previous.close().catch(this.fail);
    clearTimeout(this.statsTimer);
    clearTimeout(this.autosaveTimer);
    this.editor = null;
    this.commands = null;
    this.epoch++;
    this.document = validated;
    this.path = path;
    this.editRevision = dirty ? 1 : 0;
    this.lastSavedRevision = 0;
    this.saveFailed = false;
    this.recoveryId = crypto.randomUUID();
    this.recoveredRevision = -1;
    this.lastRecoveryAt = Date.now();
    this.recoveryRetryAfter = 0;
    this.outline = [];
    this.words = 0;
    this.characters = 0;
    this.packagedSize = loaded?.size ?? null;
  }
  newDocument(size: 'A4' | 'Letter') {
    if (!this.saving && !this.loading) this.load(createDocument(size), null);
  }
  async open(path?: string) {
    if (this.saving || this.loading) return;
    this.loading = true;
    const previous = this.editor;
    const previousCommands = this.commands;
    this.commands = null;
    previous?.setEditable(false);
    try {
      const selected = path ?? (await chooseOpen());
      if (!selected) return;
      const loaded = await repository.open(selected);
      try {
        this.load(loaded.document, selected, loaded.migrated, loaded);
      } catch (error) {
        await new AssetManager(loaded.sessionId).close();
        throw error;
      }
      await this.recentDocuments.remember(selected, loaded.document.metadata.title);
    } finally {
      if (previous && !previous.isDestroyed) previous.setEditable(true);
      if (this.editor === previous) this.commands = previousCommands;
      this.loading = false;
      this.scheduleRecovery();
    }
  }
  async save(as = false): Promise<boolean> {
    if (!this.document || this.saving || this.loading) return false;
    this.saving = true;
    this.saveFailed = false;
    clearTimeout(this.autosaveTimer);
    const epoch = this.epoch;
    try {
      let path = !as ? this.path : null;
      if (!path) path = await chooseSave(this.document.metadata.title);
      if (!path) return false;
      if (!path.toLowerCase().endsWith('.nwr')) path += '.nwr';
      if (this.recoveryWrite) {
        try {
          await this.recoveryWrite;
        } catch (error) {
          this.fail(error);
        }
      }
      const revision = this.editRevision;
      this.savingRevision = revision;
      const doc = this.snapshot();
      doc.metadata.title =
        path
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.nwr$/i, '') || 'Untitled';
      const receipt = await repository.save(path, doc, this.assets.sessionId);
      if (this.epoch === epoch) {
        this.document.metadata = doc.metadata;
        this.path = path;
        this.lastSavedRevision = revision;
        this.packagedSize = receipt?.size ?? null;
        if (!this.dirty) {
          try {
            await this.discardRecovery();
          } catch (error) {
            this.fail(error);
          }
        }
      }
      // A recent-history failure must not misrepresent a successfully written document.
      try {
        await this.recentDocuments.remember(path, doc.metadata.title);
      } catch (error) {
        this.fail(error);
      }
      return true;
    } catch (error) {
      this.saveFailed = true;
      this.fail(error);
      return false;
    } finally {
      this.saving = false;
      this.savingRevision = null;
      this.scheduleRecovery();
    }
  }
  async autosave() {
    if (
      !this.dirty ||
      !this.editor ||
      this.saving ||
      this.loading ||
      this.recoveryWrite ||
      this.recoveredRevision === this.editRevision
    )
      return;
    const revision = this.editRevision;
    const epoch = this.epoch;
    this.recoveryWrite = recovery.save(
      {
        document: this.snapshot(),
        path: this.path,
        savedAt: new Date().toISOString(),
        editRevision: revision,
        recoveryId: this.recoveryId,
      },
      this.assets.sessionId,
    );
    try {
      await this.recoveryWrite;
      if (this.epoch === epoch) {
        this.recoveredRevision = revision;
        this.lastRecoveryAt = Date.now();
      }
    } catch (error) {
      this.recoveryRetryAfter = Date.now() + Math.max(5, this.autosaveInterval) * 1000;
      throw error;
    } finally {
      this.recoveryWrite = null;
    }
  }
  async discardRecovery() {
    const id = this.recoveryId;
    if (this.recoveryWrite) await this.recoveryWrite;
    await recovery.remove(id);
    this.recoveredRevision = -1;
  }
  async restore(snapshot: RecoveryCandidate | RecoverySnapshot) {
    if (this.saving || this.loading) return;
    this.loading = true;
    const previous = this.editor;
    const previousCommands = this.commands;
    this.commands = null;
    previous?.setEditable(false);
    try {
      if ('documentId' in snapshot) {
        const loaded = await recovery.restore(snapshot.recoveryId);
        try {
          this.load(loaded.document, snapshot.path, true, loaded);
        } catch (error) {
          await new AssetManager(loaded.sessionId).close();
          throw error;
        }
        this.recoveryId = snapshot.recoveryId;
        this.editRevision = Math.max(1, snapshot.editRevision);
        return;
      }
      this.load(deserialize($state.snapshot(snapshot.document)), snapshot.path, true);
    } finally {
      if (previous && !previous.isDestroyed) previous.setEditable(true);
      if (this.editor === previous) this.commands = previousCommands;
      this.loading = false;
      this.scheduleRecovery();
    }
  }
  async insertImage(path?: string) {
    if (!this.document || !this.editor || this.loading) return;
    const epoch = this.epoch;
    let asset;
    try {
      asset = await this.assets.importImage(path);
    } catch (error) {
      if (this.epoch !== epoch) return;
      throw error;
    }
    if (!asset || this.epoch !== epoch || !this.document || this.loading) return;
    this.document.assets[asset.id] = asset.entry;
    this.commands?.image(`asset://${asset.id}`);
  }
  close() {
    if (this.saving || this.loading) return;
    clearTimeout(this.statsTimer);
    clearTimeout(this.autosaveTimer);
    const previous = this.assets;
    this.assets = new AssetManager();
    void previous.close().catch(this.fail);
    this.document = null;
    this.editor = null;
    this.commands = null;
    this.path = null;
    this.editRevision = 0;
    this.lastSavedRevision = 0;
    this.saveFailed = false;
    this.epoch++;
  }
  navigate(position: number) {
    this.editor
      ?.chain()
      .focus()
      .setTextSelection(position + 1)
      .scrollIntoView()
      .run();
  }
  dispose() {
    clearTimeout(this.statsTimer);
    clearTimeout(this.autosaveTimer);
    void this.assets.close().catch(this.fail);
  }
}
