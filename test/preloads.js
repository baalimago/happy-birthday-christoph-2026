// Prints the modulepreload links public/index.html should carry, ready to paste into the head:
// node test/preloads.js
import { readFile } from 'node:fs/promises';
import { importMap, modulesToPreload, site } from './graph.js';

const html = await readFile(new URL('index.html', site), 'utf8');
for (const url of [...(await modulesToPreload(html, importMap(html)))].toSorted()) {
  console.log(`<link rel="modulepreload" href="${url}">`);
}
