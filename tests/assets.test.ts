import { beforeEach, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/services/native/bridge', () => ({ call: invoke, native: true }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: () => 'nwr-asset://localhost/' }));
import { AssetManager } from '../src/lib/services/documents/assets';
const id = `image-${'a'.repeat(64)}`;
const entry = {
  path: `assets/${id}.png`,
  mimeType: 'image/png' as const,
  sha256: 'a'.repeat(64),
  size: 128,
};
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === 'create_asset_session'
      ? 'session-1'
      : command === 'import_image'
        ? { id, entry }
        : undefined,
  );
});
it('resolves logical IDs only within its own manifest and session', () => {
  const assets = new AssetManager('session-1', { [id]: entry });
  expect(assets.resolveAsset(`asset://${id}`)).toBe(`nwr-asset://localhost/session-1/${id}`);
  expect(assets.resolveAsset('asset://../../etc/passwd')).toBeNull();
  expect(new AssetManager('other').resolveAsset(`asset://${id}`)).toBeNull();
});
it('deduplicates manifest entries and creates a native session only once', async () => {
  const assets = new AssetManager();
  await assets.addAsset('/image.png');
  await assets.addAsset('/image-copy.png');
  expect(Object.keys(assets.listAssets())).toEqual([id]);
  expect(invoke.mock.calls.filter(([name]) => name === 'create_asset_session')).toHaveLength(1);
});
it('prunes only the saved manifest while preserving assets used by undo', () => {
  const assets = new AssetManager('session-1', { [id]: entry });
  expect(assets.cleanupUnusedAssets({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual({});
  expect(assets.hasAsset(`asset://${id}`)).toBe(true);
  const content = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: `asset://${id}` } },
      { type: 'image', attrs: { src: `asset://${id}` } },
    ],
  };
  expect(Object.keys(assets.cleanupUnusedAssets(content))).toEqual([id]);
});
it('revokes resolution and native access on close', async () => {
  const assets = new AssetManager('session-1', { [id]: entry });
  await assets.close();
  expect(assets.resolveAsset(`asset://${id}`)).toBeNull();
  expect(invoke).toHaveBeenCalledWith('close_asset_session', { sessionId: 'session-1' });
  await expect(assets.ensureSession()).rejects.toThrow('closed');
});
it('allows retry after transient native session creation failure', async () => {
  invoke.mockRejectedValueOnce(new Error('Temporary failure'));
  const assets = new AssetManager();
  await expect(assets.ensureSession()).rejects.toThrow('failure');
  await expect(assets.ensureSession()).resolves.toBe('session-1');
});
