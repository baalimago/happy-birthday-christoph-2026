// The module graph of the site, read from the source: which modules a page will run.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const site = new URL('../public/', import.meta.url);

/** The document's import map. @param {string} html @returns {Record<string, string>} */
export function importMap(html) {
  const body = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(body, 'import map missing');
  return JSON.parse(body).imports;
}

/**
 * A specifier as the URL path the browser would fetch.
 * @param {string} specifier
 * @param {string} from the importing module's path, such as '/js/main.js'
 * @param {Record<string, string>} map
 */
export function resolve(specifier, from, map) {
  const prefix = Object.keys(map)
    .filter((key) => specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return map[prefix] + specifier.slice(prefix.length);
  return new URL(specifier, `https://app${from}`).pathname;
}

/** Comments out, so an import quoted in prose is not taken for one. @param {string} source */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// import 'x' | import a, { b } from "x" (over several lines too) | export * from 'x' | export { a } from 'x'
const STATIC = /^\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]+)\1/gm;
const DYNAMIC = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const ISLAND =
  /lazyDefine\(\s*(['"])([\w-]+)\1\s*,\s*\(\)\s*=>\s*import\(\s*(['"])([^'"]+)\3\s*\)\s*,?\s*\)/g;

/** @param {string} source */
export const staticImports = (source) =>
  [...code(source).matchAll(STATIC)].map((match) => match[2]);
/** @param {string} source */
export const dynamicImports = (source) =>
  [...code(source).matchAll(DYNAMIC)].map((match) => match[2]);

/**
 * Every module reached from `entry` by static imports, `entry` included.
 * @param {string} entry
 * @param {Record<string, string>} map
 * @param {Set<string>} [seen]
 */
export async function staticGraph(entry, map, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = await readFile(new URL(`.${entry}`, site), 'utf8').catch(() => {
    throw new Error(`${entry} is imported but is not a file under public/`);
  });
  for (const specifier of staticImports(source)) {
    await staticGraph(resolve(specifier, entry, map), map, seen);
  }
  return seen;
}

/**
 * What the document should list as modulepreload: everything /js/main.js imports statically,
 * and the graph of every `lazyDefine` island whose tag is in the document.
 * @param {string} html
 * @param {Record<string, string>} map
 */
export async function modulesToPreload(html, map) {
  const main = code(await readFile(new URL('js/main.js', site), 'utf8'));
  const expected = await staticGraph('/js/main.js', map);
  expected.delete('/js/main.js');
  for (const [, , tag, , specifier] of main.matchAll(ISLAND)) {
    if (!html.includes(`<${tag}`)) continue;
    for (const url of await staticGraph(resolve(specifier, '/js/main.js', map), map)) {
      expected.add(url);
    }
  }
  return expected;
}
