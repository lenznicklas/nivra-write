import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), call: vi.fn() }));
vi.mock('../src/lib/services/native/bridge', () => ({
  native: true,
  readState: mocks.read,
  writeState: mocks.write,
  call: mocks.call,
}));
import { RecentDocuments } from '../src/lib/stores/recent.svelte';
const entry = (path: string) => ({ path, title: path, lastOpened: '2026-01-01' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([entry('/a'), entry('/b')]);
  mocks.call.mockResolvedValue([true, false]);
  mocks.write.mockResolvedValue(undefined);
});
it('checks availability asynchronously and keeps stale entries removable', async () => {
  const recent = new RecentDocuments();
  await recent.load();
  expect(recent.items.map((e) => e.available)).toEqual([true, false]);
  await recent.remove('/b');
  expect(recent.items.map((e) => e.path)).toEqual(['/a']);
  expect(mocks.write).toHaveBeenLastCalledWith('recents', [{ ...entry('/a'), available: true }]);
});
it('serializes rapid removals so the last persisted history is current', async () => {
  const recent = new RecentDocuments();
  recent.items = [entry('/a'), entry('/b')];
  let finish: () => void = () => {};
  mocks.write.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  const first = recent.remove('/a');
  const second = recent.remove('/b');
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  finish();
  await Promise.all([first, second]);
  expect(mocks.write.mock.calls[0][1]).toEqual([entry('/b')]);
  expect(mocks.write.mock.calls[1][1]).toEqual([]);
});
it('does not apply an old existence check after history changes', async () => {
  const recent = new RecentDocuments();
  recent.items = [entry('/a')];
  let finish: (exists: boolean[]) => void = () => {};
  mocks.call.mockImplementationOnce(() => new Promise<boolean[]>((resolve) => (finish = resolve)));
  const refresh = recent.refreshAvailability();
  await recent.remember('/new', 'New');
  finish([false]);
  await refresh;
  expect(recent.items[0]).toMatchObject({ path: '/new', available: true });
});
