// The shell of the one document: CSP hashes, the import map mirror, one purpose, the preload list,
// and the import boundaries from docs/ARCHITECTURE.md ("Separation of concerns").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { inlineScriptSources } from './csp-hash.js';
import {
  dynamicImports,
  importMap,
  modulesToPreload,
  resolve,
  site,
  staticImports,
} from './graph.js';

const root = new URL('../', import.meta.url);

const document = () => readFile(new URL('index.html', site), 'utf8');

/** package.json "imports" as an import map over the site: '#lib/' to '/js/lib/'. */
async function packageMap() {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  return Object.fromEntries(
    Object.entries(pkg.imports).map(([key, target]) => [
      key.replace(/\*$/, ''),
      String(target)
        .replace(/^\.\/public/, '')
        .replace(/\*$/, ''),
    ]),
  );
}

test('the CSP allows every inline script by hash', async () => {
  const html = await document();
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP missing');
  const sources = inlineScriptSources(html);
  assert.ok(sources.length > 0, 'no inline script found, yet the import map is one');
  for (const { type, source } of sources) {
    assert.ok(csp.includes(source), `CSP lacks ${source} (${type}); run: node test/csp-hash.js`);
  }
});

test('package.json imports mirror the import map', async () => {
  assert.deepEqual(await packageMap(), importMap(await document()));
});

test('the document declares one purpose', async () => {
  const html = await document();
  assert.equal(html.match(/<title>[^<]+<\/title>/g)?.length, 1, 'one title');
  assert.equal(
    html.match(/<meta\s+name="description"\s+content="[^"]+"\s*\/?>/g)?.length,
    1,
    'one description',
  );
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1, 'one h1');
  assert.equal(html.match(/<main[\s>]/g)?.length, 1, 'one main');
});

test('the import patterns read every form of import', () => {
  const source = [
    `import 'a.js';`,
    `import b from "b.js";`,
    `import {`,
    `  c,`,
    `  d as e,`,
    `} from './c.js';`,
    `import * as f from "#lib/f.js"`,
    `export { g } from './g.js';`,
    `export * from "./h.js";`,
    `// import 'no.js';`,
    `/* import 'no.js'; */`,
    `export const i = 'no.js';`,
    `const j = await import('./j.js');`,
    `load(() => import("#lib/k.js"));`,
  ].join('\n');
  assert.deepEqual(staticImports(source), [
    'a.js',
    'b.js',
    './c.js',
    '#lib/f.js',
    './g.js',
    './h.js',
  ]);
  assert.deepEqual(dynamicImports(source), ['./j.js', '#lib/k.js']);
});

test('the document preloads exactly the modules it will run', async () => {
  const html = await document();
  const map = importMap(html);
  const expected = await modulesToPreload(html, map);
  const listed = [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"\s*\/?>/g)].map(
    ([, href]) => href,
  );
  assert.deepEqual(listed.toSorted(), [...expected].toSorted());
});

// Separation of concerns: what each folder may import besides itself. A trailing slash allows a
// whole folder, anything else one file.
const BOUNDARIES = {
  '/js/game/': [],
  '/js/stores/': ['/js/lib/'],
  '/js/render/': [],
  '/js/input/': [],
  '/js/components/voyage-sea/': ['/js/game/', '/js/stores/', '/js/render/', '/js/input/'],
  '/js/components/voyage-hud/': ['/js/stores/', '/js/game/objectives.js'],
  '/js/components/voyage-chart/': ['/js/stores/', '/js/game/terrain.js', '/js/game/chart-data.js'],
  '/js/components/voyage-log/': ['/js/stores/'],
  '/js/gift/': [],
  '/js/lib/': [],
};
// main.js wires the page together, so it may import anything.
const FREE = ['/js/main.js'];

test('no module imports across the boundaries of its folder', async () => {
  const map = await packageMap();
  const files = (await readdir(new URL('js/', site), { recursive: true }))
    .map((name) => `/js/${name.replaceAll('\\', '/')}`)
    .filter((path) => path.endsWith('.js') && !path.endsWith('.test.js'));
  const strays = [];
  for (const file of files) {
    if (FREE.includes(file)) continue;
    const folder = Object.keys(BOUNDARIES).find((prefix) => file.startsWith(prefix));
    if (!folder) {
      strays.push(`${file}: no folder in the architecture owns this file`);
      continue;
    }
    const allowed = [folder, ...BOUNDARIES[/** @type {keyof typeof BOUNDARIES} */ (folder)]];
    const source = await readFile(new URL(`.${file}`, site), 'utf8');
    for (const specifier of [...staticImports(source), ...dynamicImports(source)]) {
      const target = resolve(specifier, file, map);
      const ok = allowed.some((rule) =>
        rule.endsWith('/') ? target.startsWith(rule) : target === rule,
      );
      if (!ok) strays.push(`${file} imports ${specifier}`);
    }
  }
  assert.deepEqual(strays, []);
});
