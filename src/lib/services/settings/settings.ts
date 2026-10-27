import { readState, writeState } from '../native/bridge';
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  defaultZoom: number;
  autosave: boolean;
  autosaveInterval: number;
  outline: boolean;
  pageSize: 'A4' | 'Letter';
}
export const defaults: Settings = {
  theme: 'system',
  defaultZoom: 100,
  autosave: true,
  autosaveInterval: 15,
  outline: true,
  pageSize: 'A4',
};
export function parseSettings(value: unknown): Settings {
  const v =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Partial<Settings>)
      : null;
  return {
    theme: ['system', 'light', 'dark'].includes(v?.theme ?? '') ? v!.theme! : defaults.theme,
    defaultZoom:
      typeof v?.defaultZoom === 'number' && Number.isFinite(v.defaultZoom)
        ? Math.min(200, Math.max(50, v.defaultZoom))
        : 100,
    autosave: typeof v?.autosave === 'boolean' ? v.autosave : true,
    autosaveInterval:
      typeof v?.autosaveInterval === 'number' && Number.isFinite(v.autosaveInterval)
        ? Math.max(5, Math.min(300, v.autosaveInterval))
        : 15,
    outline: typeof v?.outline === 'boolean' ? v.outline : true,
    pageSize: v?.pageSize === 'Letter' ? 'Letter' : 'A4',
  };
}
export const loadSettings = async () => parseSettings(await readState('settings', defaults));
export const saveSettings = (settings: Settings) => writeState('settings', parseSettings(settings));
