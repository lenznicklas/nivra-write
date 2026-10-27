import type { WriterDocument } from '../../editor/document/model';
export interface PageGeometry {
  width: number;
  minHeight: number;
  padding: string;
}
export interface PageLayoutService {
  geometry(settings: WriterDocument['pageSettings']): PageGeometry;
}
export const pageLayout: PageLayoutService = {
  geometry(settings) {
    const mm = 96 / 25.4;
    let [w, h] = settings.size === 'A4' ? [210, 297] : [215.9, 279.4];
    if (settings.orientation === 'landscape') [w, h] = [h, w];
    const m = settings.margins;
    return {
      width: w * mm,
      minHeight: h * mm,
      padding: `${m.top * mm}px ${m.right * mm}px ${m.bottom * mm}px ${m.left * mm}px`,
    };
  },
};
