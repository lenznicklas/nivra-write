import { save } from '@tauri-apps/plugin-dialog';
import { call } from '../native/bridge';
export interface DocumentExporter {
  extension: string;
  export(html: string, text: string): string;
}
const exporters: Record<'html' | 'txt', DocumentExporter> = {
  html: {
    extension: 'html',
    export: (html) =>
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Document</title><style>body{max-width:44rem;margin:4rem auto;font:12pt Georgia;line-height:1.6}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}</style><body>${html}</body></html>`,
  },
  txt: { extension: 'txt', export: (_, text) => text },
};
export async function exportDocument(
  format: 'html' | 'txt',
  title: string,
  html: string,
  text: string,
  sessionId: string | null = null,
) {
  const exporter = exporters[format];
  const path = await save({
    defaultPath: `${title}.${exporter.extension}`,
    filters: [{ name: format.toUpperCase(), extensions: [exporter.extension] }],
  });
  if (path)
    await call(format === 'html' ? 'export_html' : 'export_file', {
      path,
      content: exporter.export(html, text),
      sessionId,
    });
}
