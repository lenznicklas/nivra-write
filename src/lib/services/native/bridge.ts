import { invoke, isTauri } from '@tauri-apps/api/core';
export const native = isTauri();
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!native)
    throw new Error('This operation requires the desktop application. Run npm run tauri dev.');
  return invoke<T>(command, args);
}
export async function readState<T>(key: string, fallback: T): Promise<T> {
  if (!native) return fallback;
  return (await call<T | null>('read_state', { key })) ?? fallback;
}
export async function writeState(key: string, value: unknown): Promise<void> {
  if (native) await call('write_state', { key, value });
}
