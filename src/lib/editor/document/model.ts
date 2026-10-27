import type { JSONContent } from '@tiptap/core';
export interface AssetEntry {
  path: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  size: number;
}
export const CURRENT_FORMAT_VERSION = 2;
export const ASSET_ID = /^image-[a-f0-9]{64}$/;
export interface WriterDocument {
  formatVersion: 2;
  assets: Record<string, AssetEntry>;
  metadata: {
    id: string;
    title: string;
    createdAt: string;
    modifiedAt: string;
    author: string;
    applicationVersion: string;
  };
  pageSettings: {
    size: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    margins: { top: number; right: number; bottom: number; left: number };
  };
  content: JSONContent;
}
export function createDocument(size: 'A4' | 'Letter' = 'A4'): WriterDocument {
  const now = new Date().toISOString();
  return {
    formatVersion: 2,
    assets: {},
    metadata: {
      id: crypto.randomUUID(),
      title: 'Untitled',
      createdAt: now,
      modifiedAt: now,
      author: '',
      applicationVersion: '0.2.0',
    },
    pageSettings: {
      size,
      orientation: 'portrait',
      margins: { top: 25, right: 25, bottom: 25, left: 25 },
    },
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}
const nodes = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'codeBlock',
  'pageBreak',
]);
const marks = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'textStyle',
  'highlight',
  'link',
  'code',
]);
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function validateNode(v: unknown, depth = 0): void {
  if (!record(v) || typeof v.type !== 'string' || !nodes.has(v.type) || depth > 100)
    throw new Error('Invalid document content');
  if (v.text !== undefined && typeof v.text !== 'string') throw new Error('Invalid text');
  if (v.attrs !== undefined && !record(v.attrs)) throw new Error('Invalid attributes');
  const attrs = v.attrs as Record<string, unknown> | undefined;
  if (
    v.type === 'image' &&
    (typeof attrs?.src !== 'string' || !/^asset:\/\/image-[a-f0-9]{64}$/.test(attrs.src))
  )
    throw new Error('Unsafe image source');
  if (v.content !== undefined) {
    if (!Array.isArray(v.content)) throw new Error('Invalid content');
    v.content.forEach((n) => validateNode(n, depth + 1));
  }
  if (v.marks !== undefined) {
    if (!Array.isArray(v.marks)) throw new Error('Invalid marks');
    for (const mark of v.marks) {
      if (!record(mark) || typeof mark.type !== 'string' || !marks.has(mark.type))
        throw new Error('Invalid formatting');
      if (
        mark.type === 'link' &&
        (!record(mark.attrs) ||
          typeof mark.attrs.href !== 'string' ||
          !/^(https?:|mailto:)/i.test(mark.attrs.href))
      )
        throw new Error('Unsafe link');
    }
  }
}
export function deserialize(value: unknown): WriterDocument {
  if (!record(value) || typeof value.formatVersion !== 'number')
    throw new Error('Invalid document format version.');
  if (value.formatVersion > CURRENT_FORMAT_VERSION)
    throw new Error('This document was created with a newer version of Nivra Writer.');
  if (value.formatVersion !== CURRENT_FORMAT_VERSION)
    throw new Error('This document requires migration by the native document loader.');
  const m = value.metadata;
  const p = value.pageSettings;
  if (
    !record(m) ||
    !['id', 'title', 'createdAt', 'modifiedAt', 'author', 'applicationVersion'].every(
      (k) => typeof m[k] === 'string',
    ) ||
    !/^[a-zA-Z0-9-]+$/.test(String(m.id))
  )
    throw new Error('Invalid document metadata');
  if (
    !record(p) ||
    !['A4', 'Letter'].includes(String(p.size)) ||
    !['portrait', 'landscape'].includes(String(p.orientation)) ||
    !record(p.margins) ||
    !['top', 'right', 'bottom', 'left'].every(
      (k) =>
        typeof (p.margins as Record<string, unknown>)[k] === 'number' &&
        Number((p.margins as Record<string, unknown>)[k]) >= 0 &&
        Number((p.margins as Record<string, unknown>)[k]) <= 70,
    )
  )
    throw new Error('Invalid page settings');
  if (!record(value.assets)) throw new Error('Invalid document asset manifest.');
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  for (const [id, entry] of Object.entries(value.assets)) {
    if (
      !ASSET_ID.test(id) ||
      !record(entry) ||
      typeof entry.mimeType !== 'string' ||
      !Object.hasOwn(extensions, entry.mimeType) ||
      entry.sha256 !== id.slice(6) ||
      entry.path !== `assets/${id}.${extensions[entry.mimeType as keyof typeof extensions]}` ||
      typeof entry.size !== 'number' ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.size > 32 * 1024 * 1024
    )
      throw new Error('Invalid document asset manifest entry.');
  }
  validateNode(value.content);
  for (const id of assetReferences(value.content as JSONContent))
    if (!(id in value.assets)) throw new Error(`Missing image asset: ${id}`);
  if ((value.content as JSONContent).type !== 'doc') throw new Error('Missing document root');
  return structuredClone(value) as unknown as WriterDocument;
}
export function serialize(doc: WriterDocument): string {
  return JSON.stringify(deserialize(doc));
}

export function assetReferences(node: JSONContent): Set<string> {
  const refs = new Set<string>();
  function visit(node: JSONContent) {
    if (node.type === 'image' && typeof node.attrs?.src === 'string')
      refs.add(node.attrs.src.replace(/^asset:\/\//, ''));
    node.content?.forEach(visit);
  }
  visit(node);
  return refs;
}
