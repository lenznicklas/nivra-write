import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { call, native } from '../native/bridge';
import {
  ASSET_ID,
  assetReferences,
  type AssetEntry,
  type WriterDocument,
} from '../../editor/document/model';
import type { AssetResolver } from '../../editor/document/assets';
export interface ImportedAsset {
  id: string;
  entry: AssetEntry;
}
export class AssetManager implements AssetResolver {
  private token: string | null = null;
  private creating: Promise<string> | null = null;
  private manifest: Record<string, AssetEntry> = {};
  private closed = false;
  constructor(sessionId: string | null = null, manifest: Record<string, AssetEntry> = {}) {
    this.token = sessionId;
    this.manifest = { ...manifest };
  }
  get sessionId() {
    return this.token;
  }
  async ensureSession() {
    if (this.closed) throw new Error('This document has been closed.');
    if (this.token) return this.token;
    this.creating ??= call<string>('create_asset_session');
    const creating = this.creating;
    let token: string;
    try {
      token = await creating;
    } finally {
      if (this.creating === creating) this.creating = null;
    }
    if (this.closed) {
      await call('close_asset_session', { sessionId: token });
      throw new Error('This document has been closed.');
    }
    this.token = token;
    return token;
  }
  async addAsset(path: string): Promise<ImportedAsset> {
    const sessionId = await this.ensureSession();
    const asset = await call<ImportedAsset>('import_image', { sessionId, path });
    if (!ASSET_ID.test(asset.id) || asset.entry.sha256 !== asset.id.slice(6))
      throw new Error('Native asset validation failed.');
    this.manifest[asset.id] = asset.entry;
    return asset;
  }
  async importImage(path?: string) {
    const selected =
      path ??
      (await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      }));
    return selected ? this.addAsset(selected) : null;
  }
  resolveAsset(reference: string): string | null {
    const id = reference.replace(/^asset:\/\//, '');
    if (!this.token || !ASSET_ID.test(id) || !this.manifest[id]) return null;
    return `${native ? convertFileSrc('', 'nwr-asset') : 'nwr-asset://localhost/'}${this.token}/${id}`;
  }
  hasAsset(reference: string) {
    const id = reference.replace(/^asset:\/\//, '');
    return ASSET_ID.test(id) && !!this.manifest[id];
  }
  listAssets() {
    return { ...this.manifest };
  }
  // Keep native bytes for undo/redo. Only the saved manifest is pruned.
  cleanupUnusedAssets(content: WriterDocument['content']) {
    const refs = assetReferences(content);
    return Object.fromEntries(Object.entries(this.manifest).filter(([id]) => refs.has(id)));
  }
  removeAsset(id: string) {
    delete this.manifest[id];
  }
  async close() {
    this.closed = true;
    const token = this.token;
    this.token = null;
    if (token && native) await call('close_asset_session', { sessionId: token });
  }
}
