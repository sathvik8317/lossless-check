import { averageSpectrum, findCutoff, padded16 } from './lib/spectrum.js';
import { canonicalize } from './lib/pcm.js';
import { parseFile } from './lib/container.js';
import { verdict, khz } from './lib/verdict.js';

const MAX_BYTES = 600 * 1024 * 1024;
const $ = (s) => document.querySelector(s);
const results = [];
window.__results = results; // read by the test driver

const queue = [];
let running = false;

function addFiles(list) {
  const files = [...list].filter((f) => /\.(flac|wav)$/i.test(f.name));
  files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  if (!files.length) {
    status('No FLAC or WAV files in that selection.');
    return;
  }
  queue.push(...files);
  $('#results').hidden = false;
  if (!running) run();
}

async function run() {
  running = true;
  while (queue.length) {
    const file = queue.shift();
    status(`Checking ${results.length + 1} of ${results.length + 1 + queue.length}: ${file.name}`);
    const r = await check(file);
    results.push(r);
    addRow(r);
    summary();
  }
  running = false;
  status(`Done. ${results.length} file${results.length === 1 ? '' : 's'} checked.`);
  window.__done = true;
}

async function check(file) {
  const base = { name: file.name, path: file.webkitRelativePath || file.name, size: file.size };
  try {
    if (file.size > MAX_BYTES) throw new Error('file is too big to check in a browser tab');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = parseFile(file.name, bytes);
    const ctx = new OfflineAudioContext(Math.min(info.channels, 2), 1, info.rate);
    const audio = await ctx.decodeAudioData(info.clean.buffer.slice(info.clean.byteOffset, info.clean.byteOffset + info.clean.byteLength));
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    canonicalize(channels, info.bits);
    const n = channels[0].length;
    const mono = new Float32Array(n);
    for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
    const spectrum = averageSpectrum(mono, audio.sampleRate);
    const { cutoff, step } = findCutoff(spectrum);
    const padded = padded16(channels, info.bits);
    const src = { cutoff, step, padded };
    const v = verdict(info, src);
    const t = info.tags;
    return {
      ...base,
      title: t.TITLE || '',
      artist: t.ARTIST || '',
      format: info.format.toUpperCase(),
      bits: info.bits,
      rate: info.rate,
      seconds: n / audio.sampleRate,
      cutoff,
      step,
      padded,
      kind: v.kind,
      label: v.label,
      why: v.why,
      bands: Array.from(spectrum.bands, (x) => Math.round(x * 10) / 10),
      bandHz: spectrum.bandHz,
    };
  } catch (e) {
    return { ...base, kind: 'error', label: 'Could not check', why: e.message || String(e) };
  }
}

// ---------- UI ----------

function status(text) {
  $('#status').textContent = text;
}

function summary() {
  const fakes = results.filter((r) => ['lossy', 'upsampled', 'padded'].includes(r.kind)).length;
  const errors = results.filter((r) => r.kind === 'error').length;
  const ok = results.length - fakes - errors;
  $('#summary').innerHTML = '';
  const add = (n, text, cls) => {
    const el = document.createElement('div');
    el.className = `stat ${cls}`;
    el.innerHTML = `<b>${n}</b><span>${text}</span>`;
    $('#summary').append(el);
  };
  add(results.length, 'checked', '');
  add(fakes, fakes === 1 ? 'fake' : 'fakes', fakes ? 'bad' : '');
  add(ok, 'real', '');
  if (errors) add(errors, 'could not check', '');
  $('#export').hidden = !results.length;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function addRow(r) {
  const tr = document.createElement('tr');
  tr.className = `row ${r.kind}`;
  const name = r.title ? `${r.artist ? r.artist + ' – ' : ''}${r.title}` : r.name;
  const claim = r.bits ? `${r.format} ${r.bits}/${(r.rate / 1000).toFixed(r.rate % 1000 ? 1 : 0)}` : '';
  tr.innerHTML = `
    <td class="name"><div>${esc(name)}</div><small>${esc(r.path)}</small></td>
    <td class="claim">${esc(claim)}</td>
    <td class="wall">${r.cutoff ? khz(r.cutoff) : r.kind === 'error' ? '' : 'none'}</td>
    <td class="verdict"><span class="tag ${r.kind}">${esc(r.label)}</span></td>`;
  tr.tabIndex = 0;
  const detail = document.createElement('tr');
  detail.className = 'detail';
  detail.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 4;
  detail.append(td);
  const toggle = () => {
    detail.hidden = !detail.hidden;
    tr.classList.toggle('open', !detail.hidden);
    if (!detail.hidden && !td.firstChild) {
      const p = document.createElement('p');
      p.textContent = r.why;
      td.append(p);
      if (r.bands) td.append(chart(r));
    }
  };
  tr.addEventListener('click', toggle);
  tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  // Fakes go to the top of the table.
  const body = $('#rows');
  if (['lossy', 'upsampled', 'padded'].includes(r.kind)) {
    const firstReal = [...body.querySelectorAll('tr.row')].find((x) => !/(lossy|upsampled|padded)/.test(x.className));
    if (firstReal) { body.insertBefore(tr, firstReal); body.insertBefore(detail, firstReal); return; }
  }
  body.append(tr, detail);
}

// Average spectrum, 0 Hz to Nyquist, with the wall marked.
function chart(r) {
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg').trim();
  const muted = css.getPropertyValue('--muted').trim();
  const line = css.getPropertyValue('--line').trim();
  const accent = css.getPropertyValue('--accent').trim();
  const W = 760, H = 220, L = 40, B = 24, T = 10, R = 10;
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  c.className = 'chart';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `Average spectrum. ${r.cutoff ? `Wall at ${khz(r.cutoff)}.` : 'No wall.'}`);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const bands = r.bands;
  const nyq = bands.length * r.bandHz;
  const top = Math.max(...bands);
  const lo = top - 90;
  const x = (hz) => L + ((W - L - R) * hz) / nyq;
  const y = (db) => T + ((H - T - B) * (top - Math.max(lo, db))) / (top - lo);
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = muted;
  g.strokeStyle = line;
  g.lineWidth = 1;
  for (let k = 0; k <= nyq / 1000; k += nyq > 30000 ? 10 : 5) {
    g.beginPath(); g.moveTo(x(k * 1000), T); g.lineTo(x(k * 1000), H - B); g.stroke();
    g.fillText(`${k}k`, x(k * 1000) - 6, H - 8);
  }
  for (let d = 0; d <= 90; d += 30) {
    g.beginPath(); g.moveTo(L, y(top - d)); g.lineTo(W - R, y(top - d)); g.stroke();
    g.fillText(d ? `-${d}` : '0 dB', 4, y(top - d) + 4);
  }
  g.beginPath();
  bands.forEach((db, i) => { const px = x((i + 0.5) * r.bandHz); i ? g.lineTo(px, y(db)) : g.moveTo(px, y(db)); });
  g.strokeStyle = fg;
  g.lineWidth = 1.5;
  g.stroke();
  if (r.cutoff) {
    const fake = r.kind !== 'real';
    g.setLineDash([4, 4]);
    g.strokeStyle = fake ? accent : muted;
    g.beginPath(); g.moveTo(x(r.cutoff), T); g.lineTo(x(r.cutoff), H - B); g.stroke();
    g.setLineDash([]);
    g.fillStyle = fake ? accent : muted;
    g.fillText(`wall ${khz(r.cutoff)}`, Math.min(x(r.cutoff) + 6, W - 90), T + 14);
  }
  c.style.width = '100%';
  c.style.maxWidth = `${W}px`;
  return c;
}

function exportCsv() {
  const cols = ['path', 'artist', 'title', 'format', 'bits', 'rate', 'cutoff', 'kind', 'label'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...results.map((r) => cols.map((k) => q(r[k])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'lossless-check.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wiring ----------

$('#pick-folder').addEventListener('click', () => $('#folder').click());
$('#pick-files').addEventListener('click', () => $('#files').click());
$('#folder').addEventListener('change', (e) => addFiles(e.target.files));
$('#files').addEventListener('change', (e) => addFiles(e.target.files));
$('#export').addEventListener('click', exportCsv);

const drop = $('#drop');
document.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return addFiles(e.dataTransfer.files);
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name });
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${path}${entry.name}/`);
      }
    }
  };
  for (const it of items) await walk(it, '');
  addFiles(out);
});
