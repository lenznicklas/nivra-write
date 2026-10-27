// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { extensions } from '../src/lib/editor/extensions';
import { EditorCommands } from '../src/lib/editor/commands/commands';
import { createDocument, deserialize } from '../src/lib/editor/document/model';
const editors: Editor[] = [];
function setup() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: extensions(),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello writer' }] }],
    },
  });
  editors.push(editor);
  return { editor, commands: new EditorCommands(editor) };
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
describe('editor commands', () => {
  it('formats selections through ProseMirror and round trips JSON', () => {
    const { editor, commands } = setup();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    commands.run('bold');
    commands.run('italic');
    commands.run('underline');
    commands.font('Arial');
    commands.size(16);
    commands.color('#456b50');
    commands.highlight('#fff2a8');
    expect(editor.isActive('bold')).toBe(true);
    expect(editor.getAttributes('textStyle').fontSize).toBe('16pt');
    expect(deserialize({ ...createDocument(), content: editor.getJSON() }).content).toEqual(
      editor.getJSON(),
    );
  });
  it('creates headings, alignment, lists and nested indentation', () => {
    const { editor, commands } = setup();
    commands.style(2);
    commands.align('center');
    expect(editor.isActive('heading', { level: 2, textAlign: 'center' })).toBe(true);
    commands.style(0);
    commands.run('bulletList');
    expect(editor.isActive('bulletList')).toBe(true);
    commands.run('bulletList');
    commands.run('indent');
    expect(editor.getAttributes('paragraph').indent).toBe(1);
    commands.run('outdent');
    expect(editor.getAttributes('paragraph').indent).toBe(0);
  });
  it('inserts tables and manipulates rows and columns', () => {
    const { editor, commands } = setup();
    commands.run('table');
    expect(editor.isActive('table')).toBe(true);
    commands.run('addRow');
    commands.run('addColumn');
    const table: JSONContent | undefined = (editor.getJSON() as JSONContent).content?.find(
      (n) => n.type === 'table',
    );
    expect(table?.content).toHaveLength(4);
    expect(table?.content?.[0].content).toHaveLength(4);
    commands.run('deleteTable');
    expect(editor.getJSON().content?.some((n) => n.type === 'table')).toBe(false);
  });
  it('rejects unsafe links and supports valid links', () => {
    const { editor, commands } = setup();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(() => commands.link('javascript:alert(1)')).toThrow();
    commands.link('https://example.com');
    expect(editor.getAttributes('link').href).toBe('https://example.com');
    commands.link('');
    expect(editor.isActive('link')).toBe(false);
  });
  it('supports history and semantic page breaks', () => {
    const { editor, commands } = setup();
    commands.run('pageBreak');
    expect(editor.getJSON().content?.some((n) => n.type === 'pageBreak')).toBe(true);
    commands.run('undo');
    expect(editor.getJSON().content?.some((n) => n.type === 'pageBreak')).toBe(false);
    commands.run('redo');
    expect(editor.getJSON().content?.some((n) => n.type === 'pageBreak')).toBe(true);
  });
});
