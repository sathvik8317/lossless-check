// Builds dist/lossless-check.html: one self-contained file that works when
// opened straight from disk (file://), where ES module imports are blocked.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const order = ['lib/fft.js', 'lib/spectrum.js', 'lib/pcm.js', 'lib/container.js', 'lib/verdict.js', 'app.js'];
const strip = (src) =>
  src
    .replace(/^import[^;]*;\s*$/gm, '')
    .replace(/^export\s+(?=(const|function|let|class|async)\b)/gm, '');

const js = order.map((f) => `// ---- ${f}\n${strip(readFileSync(new URL(`src/${f}`, import.meta.url), 'utf8'))}`).join('\n');
if (/^\s*(import|export)\b/m.test(js)) throw new Error('an import/export survived the build');

const html = readFileSync(new URL('src/index.html', import.meta.url), 'utf8');
const tag = '<script type="module" src="app.js"></script>';
if (!html.includes(tag)) throw new Error('script tag not found in index.html');
const out = html.replace(tag, () => `<script>\n(() => {\n${js}\n})();\n</script>`);

mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/lossless-check.html', import.meta.url), out);
// GitHub Pages serves docs/index.html.
mkdirSync(new URL('docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('docs/index.html', import.meta.url), out);
console.log(`dist/lossless-check.html  ${(out.length / 1024).toFixed(1)} KB`);
