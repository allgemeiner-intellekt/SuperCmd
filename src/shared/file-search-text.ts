/** Keep names comparable across macOS normalization forms and renderer input. */
export function normalizeFileSearchText(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase()
    // Fold Latin accents without deleting marks that distinguish other scripts,
    // such as the dakuten in Japanese. Hangul remains canonically decomposed.
    .replace(/([a-z])[\u0300-\u036f]+/g, '$1');
}

export function tokenizeFileSearchText(value: string): string[] {
  const words = normalizeFileSearchText(value).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  // Preserve the old ASCII anchors in mixed names: "中文report" must still
  // match "report", while now also retaining the full Unicode token.
  return words.flatMap((word) => [...new Set([word, ...(word.match(/[a-z0-9]+/g) || [])])]);
}
