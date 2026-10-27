import { writable } from 'svelte/store';
import type { Settings } from '../services/settings/settings';
import { defaults } from '../services/settings/settings';
export const settingsStore = writable<Settings>(defaults);
export const uiStore = writable({ outline: true, zoom: 100 });
