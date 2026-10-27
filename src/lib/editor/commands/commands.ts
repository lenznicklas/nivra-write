import type { Editor } from '@tiptap/core';
export type CommandId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'undo'
  | 'redo'
  | 'clear'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'rule'
  | 'table'
  | 'pageBreak'
  | 'indent'
  | 'outdent'
  | 'addRow'
  | 'deleteRow'
  | 'addColumn'
  | 'deleteColumn'
  | 'deleteTable'
  | 'headerRow';
export class EditorCommands {
  constructor(readonly editor: Editor) {}
  run(id: CommandId) {
    const c = this.editor.chain().focus();
    switch (id) {
      case 'bold':
        return c.toggleBold().run();
      case 'italic':
        return c.toggleItalic().run();
      case 'underline':
        return c.toggleUnderline().run();
      case 'strike':
        return c.toggleStrike().run();
      case 'undo':
        return c.undo().run();
      case 'redo':
        return c.redo().run();
      case 'clear':
        return c.unsetAllMarks().clearNodes().run();
      case 'bulletList':
        return c.toggleBulletList().run();
      case 'orderedList':
        return c.toggleOrderedList().run();
      case 'blockquote':
        return c.toggleBlockquote().run();
      case 'rule':
        return c.setHorizontalRule().run();
      case 'table':
        return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case 'pageBreak':
        return c.insertContent({ type: 'pageBreak' }).run();
      case 'indent':
      case 'outdent': {
        if (this.editor.isActive('listItem'))
          return id === 'indent'
            ? c.sinkListItem('listItem').run()
            : c.liftListItem('listItem').run();
        const type = this.editor.isActive('heading') ? 'heading' : 'paragraph';
        return c
          .updateAttributes(type, {
            indent: Math.max(
              0,
              Math.min(
                8,
                Number(this.editor.getAttributes(type).indent || 0) + (id === 'indent' ? 1 : -1),
              ),
            ),
          })
          .run();
      }
      case 'addRow':
        return c.addRowAfter().run();
      case 'deleteRow':
        return c.deleteRow().run();
      case 'addColumn':
        return c.addColumnAfter().run();
      case 'deleteColumn':
        return c.deleteColumn().run();
      case 'deleteTable':
        return c.deleteTable().run();
      case 'headerRow':
        return c.toggleHeaderRow().run();
    }
  }
  font(value: string) {
    this.editor.chain().focus().setFontFamily(value).run();
  }
  size(value: number) {
    this.editor
      .chain()
      .focus()
      .setFontSize(`${Math.max(6, Math.min(144, value))}pt`)
      .run();
  }
  style(level: number) {
    const c = this.editor.chain().focus();
    if (level === 0) c.setParagraph().run();
    else c.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  }
  align(value: 'left' | 'center' | 'right' | 'justify') {
    this.editor.chain().focus().setTextAlign(value).run();
  }
  color(value: string) {
    this.editor.chain().focus().setColor(value).run();
  }
  highlight(value: string) {
    this.editor.chain().focus().setHighlight({ color: value }).run();
  }
  spacing(value: string) {
    for (const type of ['paragraph', 'heading'])
      this.editor.chain().focus().updateAttributes(type, { lineHeight: value }).run();
  }
  link(value: string) {
    if (!value.trim()) {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(value))
      throw new Error('Use a full https://, http://, or mailto: link.');
    this.editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
  }
  image(src: string) {
    this.editor.chain().focus().setImage({ src }).run();
  }
  character(value: string) {
    this.editor.chain().focus().insertContent({ type: 'text', text: value }).run();
  }
}
