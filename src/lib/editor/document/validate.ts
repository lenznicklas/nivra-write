import { getSchema } from '@tiptap/core';
import { extensions } from '../extensions';
import type { WriterDocument } from './model';
// Validate against the actual editor schema before replacing the active session.
export function validateEditorDocument(document: WriterDocument): WriterDocument {
  getSchema(extensions()).nodeFromJSON(document.content).check();
  return document;
}
