// Opens dist/lossless-check.html in headless Chrome, feeds it files through
// the file input, waits for the checks and prints the results as JSON.
// Usage: node tools/e2e.mjs out.json file1.flac file2.flac ...   (or a folder)
// Optional: SHOT=path.png takes a screenshot with the first fake opened.
import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [out, ...args] = process.argv.slice(2);
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
  else if (/\.(flac|wav)$/i.test(p)) files.push(resolve(p));
};
args.forEach(walk);

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'llc-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1100,1400', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception?.description));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: process.env.PAGE || pathToFileURL(resolve('dist/lossless-check.html')).href });
await sleep(1500);
const doc = await send('DOM.getDocument');
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#files' });
await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files });
const t0 = Date.now();
while (!(await evaluate('!!window.__done'))) await sleep(500);
const secs = (Date.now() - t0) / 1000;
const results = await evaluate('window.__results.map(({bands, ...r}) => r)');
writeFileSync(out, JSON.stringify({ seconds: secs, logs, results }, null, 2));
if (process.env.SHOT) {
  await evaluate(`(document.querySelector('tr.row.lossy, tr.row.upsampled, tr.row.padded') || document.querySelector('tr.row'))?.click()`);
  await sleep(300);
  const h = await evaluate('Math.min(document.documentElement.scrollHeight, 1600)');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: h, deviceScaleFactor: 1, mobile: false });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
}
console.log(`${results.length} files in ${secs.toFixed(1)} s; console: ${logs.length ? logs.join(' | ') : 'clean'}`);
ws.close();
chrome.kill();
