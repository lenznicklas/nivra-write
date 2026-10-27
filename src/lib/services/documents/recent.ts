export interface RecentDocument {
  available?: boolean;
  path: string;
  title: string;
  lastOpened: string;
}
export function addRecent(list: RecentDocument[], entry: RecentDocument): RecentDocument[] {
  return [entry, ...list.filter((item) => item.path !== entry.path)].slice(0, 12);
}
export function parseRecents(value: unknown): RecentDocument[] {
  return Array.isArray(value)
    ? value
        .filter(
          (v): v is RecentDocument =>
            v &&
            typeof v.path === 'string' &&
            typeof v.title === 'string' &&
            typeof v.lastOpened === 'string',
        )
        .slice(0, 12)
    : [];
}
