/** Editor-facing resolver contract. No native/filesystem dependencies. */
export interface AssetResolver {
  resolveAsset(reference: string): string | null;
  hasAsset(reference: string): boolean;
}
