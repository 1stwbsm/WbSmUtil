/**
 * Find collection names in one source text: static literals, simple named
 * constants and SQL references.
 */
export function scanCollections(text: string, add: (name: string, source: string) => void): void {
  const constants = new Map(
    [...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(['"`])([^'"`\r\n]+)\2/g)].map((m) => [m[1], m[3]]),
  );
  for (const m of text.matchAll(/\.collection\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*\)/g)) {
    const name = m[2];
    if (name && !name.includes('${')) add(name, 'source');
  }
  for (const m of text.matchAll(/\.collection\s*\(\s*([\w$]+)\s*\)/g)) {
    const value = constants.get(m[1]);
    if (value) add(value, 'source');
  }
  for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
    if (m[1]) add(m[1], 'SQL source');
  }
}
