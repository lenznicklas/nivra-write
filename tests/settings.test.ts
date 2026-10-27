import { it, expect, vi, beforeEach } from 'vitest';
const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/lib/services/native/bridge', () => ({
  readState: async (key: string, fallback: unknown) =>
    storage.has(key) ? structuredClone(storage.get(key)) : fallback,
  writeState: async (key: string, value: unknown) => {
    storage.set(key, JSON.parse(JSON.stringify(value)));
  },
}));
import { loadSettings, saveSettings, defaults } from '../src/lib/services/settings/settings';
beforeEach(() => storage.clear());
it('persists settings through the state service', async () => {
  await saveSettings({ ...defaults, theme: 'dark', defaultZoom: 125, autosave: false });
  expect(await loadSettings()).toMatchObject({ theme: 'dark', defaultZoom: 125, autosave: false });
});
it('normalizes invalid settings before persistence and on read', async () => {
  await saveSettings({ ...defaults, defaultZoom: 900 });
  expect(storage.get('settings')).toMatchObject({ defaultZoom: 200 });
  storage.set('settings', { theme: 'garbage', autosaveInterval: -1 });
  expect(await loadSettings()).toMatchObject({ theme: 'system', autosaveInterval: 5 });
});
it('returns defaults when no settings file exists', async () => {
  expect(await loadSettings()).toEqual(defaults);
});

it('persists all six preferences together', async () => {
  const settings = {
    theme: 'light' as const,
    defaultZoom: 145,
    autosave: false,
    autosaveInterval: 30,
    outline: false,
    pageSize: 'Letter' as const,
  };
  await saveSettings(settings);
  expect(await loadSettings()).toEqual(settings);
});
