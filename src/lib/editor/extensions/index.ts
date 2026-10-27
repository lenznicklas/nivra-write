import { Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import type { AssetResolver } from '../document/assets';
import { TableKit } from '@tiptap/extension-table';
const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Number(element.dataset.indent || 0),
            renderHTML: (attrs) => ({
              'data-indent': attrs.indent,
              style: `margin-left:${Math.min(8, Math.max(0, Number(attrs.indent) || 0)) * 24}px`,
            }),
          },
          lineHeight: {
            default: '1.65',
            parseHTML: (element) => element.style.lineHeight || '1.65',
            renderHTML: (attrs) => ({
              style: `line-height:${['1', '1.15', '1.5', '1.65', '2'].includes(String(attrs.lineHeight)) ? attrs.lineHeight : '1.65'}`,
            }),
          },
        },
      },
    ];
  },
});
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-page-break': 'true', class: 'page-break' }),
    'Page break',
  ],
});
export const extensions = (resolver?: AssetResolver) => [
  StarterKit.configure({ link: { openOnClick: false, protocols: ['https', 'http', 'mailto'] } }),
  TextStyleKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  Image.extend({
    parseHTML() {
      return [
        {
          tag: 'img[src]',
          getAttrs: (element) => {
            const src = element.getAttribute('src') || '';
            return /^asset:\/\/image-[a-f0-9]{64}$/.test(src) &&
              (!resolver || resolver.hasAsset(src))
              ? null
              : false;
          },
        },
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement('img');
        const render = (next: typeof node) => {
          const source = resolver?.resolveAsset(String(next.attrs.src));
          if (source) image.src = source;
          else image.removeAttribute('src');
          image.alt = String(next.attrs.alt || 'Document image');
          image.title = String(next.attrs.title || '');
        };
        render(node);
        return {
          dom: image,
          update(next) {
            if (next.type !== node.type) return false;
            render(next);
            return true;
          },
        };
      };
    },
  }),
  TableKit.configure({ table: { resizable: true } }),
  ParagraphLayout,
  PageBreak,
];
