import { addRecent, parseRecents, type RecentDocument } from '../services/documents/recent';
import { call, native, readState, writeState } from '../services/native/bridge';
export class RecentDocuments {
  items = $state<RecentDocument[]>([]);
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  async load() {
    this.items = parseRecents(await readState('recents', []));
    await this.refreshAvailability();
  }
  async refreshAvailability() {
    if (!native) return;
    const generation = ++this.generation;
    const paths = this.items.map((item) => item.path);
    const exists = await call<boolean[]>('check_recent_paths', { paths });
    if (generation === this.generation)
      this.items = this.items.map((item, i) => ({ ...item, available: exists[i] ?? false }));
  }
  private async persist() {
    const value = $state.snapshot(this.items);
    // Each caller receives its own failure; a previous failure must not poison the queue.
    const write = this.writes.catch(() => {}).then(() => writeState('recents', value));
    this.writes = write;
    await write;
  }
  async remember(path: string, title: string) {
    this.generation++;
    this.items = addRecent(this.items, {
      path,
      title,
      lastOpened: new Date().toISOString(),
      available: true,
    });
    await this.persist();
  }
  async remove(path: string) {
    this.generation++;
    this.items = this.items.filter((item) => item.path !== path);
    await this.persist();
  }
}
