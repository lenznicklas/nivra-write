// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/lib/editor/extensions';
import { EditorCommands } from '../src/lib/editor/commands/commands';
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  chooseSave: vi.fn(),
  recoverySave: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../src/lib/services/documents/repository', () => ({
  repository: { save: mocks.save },
  chooseSave: mocks.chooseSave,
  chooseOpen: vi.fn(),
}));
vi.mock('../src/lib/services/autosave/recovery', () => ({
  recovery: { save: mocks.recoverySave, remove: mocks.remove },
}));
vi.mock('../src/lib/services/native/bridge', () => ({ writeState: vi.fn(), readState: vi.fn() }));
import { DocumentSession } from '../src/lib/stores/document.svelte';
import { RecentDocuments } from '../src/lib/stores/recent.svelte';
let session: DocumentSession;
let editor: Editor;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.chooseSave.mockResolvedValue('/tmp/Test.nwr');
  mocks.recoverySave.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  session = new DocumentSession(new RecentDocuments());
  session.newDocument('A4');
  editor = new Editor({
    element: document.createElement('div'),
    extensions: extensions(),
    content: session.document!.content,
    onUpdate: session.changed,
  });
  session.attach(editor, new EditorCommands(editor));
  editor.commands.insertContent('Original');
});
afterEach(() => {
  session.dispose();
  editor.destroy();
});
it('saves a snapshot and clears the dirty flag only after success', async () => {
  expect(session.dirty).toBe(true);
  expect(await session.save()).toBe(true);
  expect(session.path).toBe('/tmp/Test.nwr');
  expect(session.dirty).toBe(false);
  expect(mocks.save.mock.calls[0][1].content.content[0].content[0].text).toBe('Original');
  expect(mocks.remove).toHaveBeenCalled();
});
it('retains edits made while a save is in flight', async () => {
  let finish: () => void = () => {};
  mocks.save.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  const saving = session.save();
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  editor.commands.insertContent(' newer');
  finish();
  expect(await saving).toBe(true);
  expect(session.dirty).toBe(true);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('preserves the session when Save As is cancelled', async () => {
  mocks.chooseSave.mockResolvedValue(null);
  expect(await session.save(true)).toBe(false);
  expect(session.dirty).toBe(true);
  expect(session.path).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('surfaces dialog errors without losing the document', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.chooseSave.mockRejectedValue(new Error('Dialog unavailable'));
  expect(await session.save()).toBe(false);
  expect(session.error).toBe('Dialog unavailable');
  expect(session.dirty).toBe(true);
  log.mockRestore();
});
it('does not serialize unchanged recovery snapshots repeatedly', async () => {
  await session.autosave();
  await session.autosave();
  expect(mocks.recoverySave).toHaveBeenCalledTimes(1);
  editor.commands.insertContent(' changed');
  await session.autosave();
  expect(mocks.recoverySave).toHaveBeenCalledTimes(2);
});
it('rejects schema-invalid content before changing the active session', () => {
  const original = session.document;
  const epoch = session.epoch;
  expect(() =>
    session.load(
      {
        ...session.snapshot(),
        content: { type: 'doc', content: [{ type: 'text', text: 'Invalid block' }] },
      },
      null,
    ),
  ).toThrow();
  expect(session.document).toBe(original);
  expect(session.editor).toBe(editor);
  expect(session.epoch).toBe(epoch);
});
it('restores a recovery document received from reactive UI state', () => {
  const document = session.document!;
  const snapshot = { document, path: '/tmp/recovered.nwr', savedAt: new Date().toISOString() };
  expect(() => session.restore(snapshot)).not.toThrow();
  expect(session.dirty).toBe(true);
  expect(session.path).toBe('/tmp/recovered.nwr');
});
it('exposes Save failed and preserves revision accuracy after a disk error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.save.mockRejectedValueOnce(new Error('Disk full'));
  const revision = session.editRevision;
  expect(await session.save()).toBe(false);
  expect(session.state).toBe('Save failed');
  expect(session.dirty).toBe(true);
  expect(session.lastSavedRevision).not.toBe(revision);
  log.mockRestore();
});
it('does not label a successful file write as failed when recent-history storage fails', async () => {
  const recent = new RecentDocuments();
  vi.spyOn(recent, 'remember').mockRejectedValue(new Error('History unavailable'));
  const another = new DocumentSession(recent);
  another.newDocument('A4');
  another.attach(editor, new EditorCommands(editor));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await another.save()).toBe(true);
  expect(another.state).toBe('Saved');
  expect(another.saveFailed).toBe(false);
  another.dispose();
  log.mockRestore();
});
it('debounces recovery and skips serialization during a manual save', async () => {
  vi.useFakeTimers();
  session.configureAutosave(true, 5);
  session.changed();
  await vi.advanceTimersByTimeAsync(4000);
  session.changed();
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.recoverySave).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1100);
  expect(mocks.recoverySave).toHaveBeenCalledTimes(1);
  session.saving = true;
  session.changed();
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.recoverySave).toHaveBeenCalledTimes(1);
  session.saving = false;
  vi.useRealTimers();
});
it('bounds recovery delay during continuous typing', async () => {
  vi.useFakeTimers();
  session.configureAutosave(true, 15);
  for (let i = 0; i < 12; i++) {
    session.changed();
    await vi.advanceTimersByTimeAsync(5000);
  }
  expect(mocks.recoverySave).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it('does not misreport a completed main save when recovery cleanup fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.remove.mockRejectedValueOnce(new Error('Recovery cleanup denied'));
  expect(await session.save()).toBe(true);
  expect(session.state).toBe('Saved');
  expect(session.error).toContain('cleanup');
  log.mockRestore();
});
