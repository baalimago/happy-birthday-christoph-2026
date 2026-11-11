// Prints the CSP sources for the inline scripts of public/index.html, ready to paste into
// script-src: node test/csp-hash.js [path/to/document.html]
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Every inline script a CSP has to allow: no src, and not JSON-LD, which is data and never runs.
 * The import map is one of them.
 * @param {string} html
 * @returns {{ type: string, source: string }[]}
 */
export function inlineScriptSources(html) {
  const sources = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=|application\/ld\+json/.test(attributes)) continue;
    const hash = createHash('sha256').update(body).digest('base64');
    const type = attributes.match(/\btype="([^"]+)"/)?.[1] ?? 'classic';
    sources.push({ type, source: `'sha256-${hash}'` });
  }
  return sources;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? new URL('../public/index.html', import.meta.url);
  const sources = inlineScriptSources(await readFile(path, 'utf8'));
  for (const { type, source } of sources) console.error(`${type}: ${source}`);
  // stdout carries only the pasteable part.
  console.log(sources.map(({ source }) => source).join(' '));
}
