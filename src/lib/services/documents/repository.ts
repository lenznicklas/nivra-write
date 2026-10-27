import { open, save } from '@tauri-apps/plugin-dialog';
import { call } from '../native/bridge';
import { deserialize, type WriterDocument } from '../../editor/document/model';
export interface DocumentImporter {
  extensions: string[];
  import(path: string): Promise<WriterDocument>;
}
export interface LoadedDocument {
  document: WriterDocument;
  sessionId: string;
  size: number;
  migrated: boolean;
}
export interface SaveReceipt {
  size: number;
}
export interface DocumentRepository {
  open(path: string): Promise<LoadedDocument>;
  save(path: string, document: WriterDocument, sessionId?: string | null): Promise<SaveReceipt>;
}
export function decodeLoaded(value: LoadedDocument): LoadedDocument {
  return { ...value, document: deserialize(value.document) };
}
export const repository: DocumentRepository = {
  open: async (path) => {
    const loaded = await call<LoadedDocument>('read_document', { path });
    try {
      return decodeLoaded(loaded);
    } catch (error) {
      await call('close_asset_session', { sessionId: loaded.sessionId });
      throw error;
    }
  },
  save: (path, document, sessionId = null) => call('write_document', { path, document, sessionId }),
};
export const chooseOpen = () =>
  open({ multiple: false, filters: [{ name: 'Nivra document', extensions: ['nwr'] }] });
export const chooseSave = (title: string) =>
  save({ defaultPath: `${title}.nwr`, filters: [{ name: 'Nivra document', extensions: ['nwr'] }] });
