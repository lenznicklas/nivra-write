import { deserialize, type WriterDocument } from '../../editor/document/model';
import { call, native } from '../native/bridge';
import { decodeLoaded, type LoadedDocument } from '../documents/repository';
export interface RecoverySnapshot {
  document: WriterDocument;
  path: string | null;
  savedAt: string;
  editRevision?: number;
  recoveryId?: string;
}
export interface RecoveryCandidate {
  recoveryId: string;
  documentId: string;
  title: string;
  path: string | null;
  savedAt: string;
  editRevision: number;
  originalExists: boolean;
  document?: WriterDocument;
}
export interface RecoveryCatalog {
  snapshots: RecoveryCandidate[];
  issues: string[];
}
export function parseCandidate(value: unknown): RecoveryCandidate {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid recovery metadata.');
  const v = value as Record<string, unknown>;
  if (
    !['recoveryId', 'documentId', 'title', 'savedAt'].every((k) => typeof v[k] === 'string') ||
    !(v.path === null || typeof v.path === 'string') ||
    typeof v.editRevision !== 'number' ||
    !Number.isSafeInteger(v.editRevision) ||
    v.editRevision < 0 ||
    typeof v.originalExists !== 'boolean'
  )
    throw new Error('Invalid recovery metadata.');
  return {
    recoveryId: String(v.recoveryId),
    documentId: String(v.documentId),
    title: String(v.title),
    path: v.path as string | null,
    savedAt: String(v.savedAt),
    editRevision: v.editRevision,
    originalExists: v.originalExists,
    ...(v.document ? { document: deserialize(v.document) } : {}),
  };
}
export const recovery = {
  async list(): Promise<RecoveryCatalog> {
    if (!native) return { snapshots: [], issues: [] };
    const catalog = await call<{ snapshots: unknown[]; issues: string[] }>('list_recovery');
    const snapshots: RecoveryCandidate[] = [];
    for (const value of catalog.snapshots) {
      try {
        snapshots.push(parseCandidate(value));
      } catch (error) {
        catalog.issues.push(`A recovery snapshot could not be read: ${String(error)}`);
      }
    }
    return { snapshots, issues: catalog.issues };
  },
  save: (snapshot: RecoverySnapshot, sessionId: string | null = null): Promise<void> =>
    native
      ? call('save_recovery', {
          id: snapshot.recoveryId ?? snapshot.document.metadata.id,
          snapshot,
          sessionId,
        })
      : Promise.resolve(),
  restore: async (id: string): Promise<LoadedDocument> =>
    decodeLoaded(await call<LoadedDocument>('restore_recovery', { id })),
  remove: (id: string): Promise<void> =>
    native ? call('delete_recovery', { id }) : Promise.resolve(),
};
