import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          prosemirror: [
            '@tiptap/pm/model',
            '@tiptap/pm/state',
            '@tiptap/pm/view',
            '@tiptap/pm/transform',
          ],
          tiptap: [
            '@tiptap/core',
            '@tiptap/starter-kit',
            '@tiptap/extension-table',
            '@tiptap/extension-text-style',
            '@tiptap/extension-image',
            '@tiptap/extension-highlight',
            '@tiptap/extension-text-align',
          ],
        },
      },
    },
  },
});
