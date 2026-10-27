import { describe, it, expect } from 'vitest';
import { createDocument, serialize, deserialize } from '../src/lib/editor/document/model';
import { addRecent, parseRecents } from '../src/lib/services/documents/recent';
import { parseSettings, defaults } from '../src/lib/services/settings/settings';
import { textCounts } from '../src/lib/utils/text';
import { pageLayout } from '../src/lib/services/layout/page-layout';
describe('document format', () => {
  it('round trips structured content and metadata', () => {
    const doc = createDocument();
    doc.content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
        },
        { type: 'paragraph' },
      ],
    };
    expect(deserialize(JSON.parse(serialize(doc)))).toEqual(doc);
  });
  it('rejects future versions and malformed roots', () => {
    expect(() => deserialize({ ...createDocument(), formatVersion: 3 })).toThrow('version');
    expect(() =>
      deserialize({ ...createDocument(), content: { type: 'text', text: 'x' } }),
    ).toThrow();
  });
  it('rejects unsafe links and remote images', () => {
    for (const node of [
      { type: 'image', attrs: { src: 'https://tracker.example/x.png' } },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
    ])
      expect(() =>
        deserialize({ ...createDocument(), content: { type: 'doc', content: [node] } }),
      ).toThrow();
  });
  it('rejects invalid margins and metadata', () => {
    const doc = createDocument();
    doc.pageSettings.margins.top = -1;
    expect(() => deserialize(doc)).toThrow();
    expect(() => deserialize({ ...createDocument(), metadata: { id: '../../file' } })).toThrow();
  });
  it('rejects excessive nesting', () => {
    let node: unknown = { type: 'paragraph' };
    for (let i = 0; i < 105; i++) node = { type: 'blockquote', content: [node] };
    expect(() =>
      deserialize({ ...createDocument(), content: { type: 'doc', content: [node] } }),
    ).toThrow();
  });
});
describe('recent documents', () => {
  it('deduplicates and moves the newest to front', () => {
    const a = { path: '/a', title: 'A', lastOpened: '2026-01-01' };
    const b = { ...a, path: '/b' };
    expect(addRecent([a, b], { ...a, title: 'Updated' })).toEqual([{ ...a, title: 'Updated' }, b]);
  });
  it('caps history and rejects corrupt entries', () => {
    expect(
      addRecent(
        Array.from({ length: 15 }, (_, i) => ({ path: `/${i}`, title: 'x', lastOpened: '' })),
        { path: '/new', title: 'new', lastOpened: '' },
      ),
    ).toHaveLength(12);
    expect(parseRecents([null, {}, 'bad'])).toEqual([]);
  });
});
describe('settings and utilities', () => {
  it('round trips settings through JSON persistence', () => {
    const input = { ...defaults, theme: 'dark' as const, autosave: false, defaultZoom: 125 };
    expect(parseSettings(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
  it('uses defaults and constrains invalid settings', () => {
    expect(parseSettings(null)).toEqual(defaults);
    expect(
      parseSettings({ defaultZoom: 400, autosaveInterval: 0, theme: 'invalid' }),
    ).toMatchObject({ defaultZoom: 200, autosaveInterval: 5, theme: 'system' });
  });
  it('counts words and Unicode code points', () => {
    expect(textCounts('')).toEqual({ words: 0, characters: 0 });
    expect(textCounts('Hello  world\n🙂')).toEqual({ words: 3, characters: 14 });
  });
  it('separates layout from content and rotates page geometry', () => {
    const doc = createDocument();
    const portrait = pageLayout.geometry(doc.pageSettings);
    doc.pageSettings.orientation = 'landscape';
    const landscape = pageLayout.geometry(doc.pageSettings);
    expect(portrait.width).toBe(landscape.minHeight);
    expect(doc.content.type).toBe('doc');
  });
});
