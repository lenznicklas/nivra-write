export function textCounts(text: string) {
  return {
    words: text.trim() ? text.trim().split(/\s+/u).length : 0,
    characters: Array.from(text).length,
  };
}
export function errorMessage(error: unknown): string {
  console.error('[Nivra Writer]', error);
  return error instanceof Error ? error.message : String(error);
}
