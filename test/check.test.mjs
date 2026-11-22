import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageSpectrum, findCutoff, padded16 } from '../src/lib/spectrum.js';
import { parseFlac, parseWav } from '../src/lib/container.js';
import { verdict, lossySource } from '../src/lib/verdict.js';

// "Music": a tone every 100 Hz up to `top`, falling gently with frequency and
// with random wobble, plus a white floor (dither) far below.
function music(rate, top, { seconds = 4, floor = 1e-5, seed = 1 } = {}) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const n = rate * seconds;
  const out = new Float32Array(n);
  for (let f = 150; f < top; f += 100) {
    const amp = (0.02 / Math.sqrt(f / 150)) * (0.5 + rand());
    const ph = rand() * 2 * Math.PI;
    const w = (2 * Math.PI * f) / rate;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i + ph);
  }
  for (let i = 0; i < n; i++) out[i] += floor * (rand() * 2 - 1);
  return out;
}
const cutoffOf = (x, rate) => findCutoff(averageSpectrum(x, rate)).cutoff;

test('a brick wall below Nyquist is found where the encoder put it', () => {
  const c128 = cutoffOf(music(44100, 16000), 44100);
  assert.ok(c128 > 15700 && c128 < 16300, `128 kbps-style wall at ${c128}`);
  const c320 = cutoffOf(music(44100, 20000), 44100);
  assert.ok(c320 > 19700 && c320 < 20300, `320 kbps-style wall at ${c320}`);
  assert.equal(cutoffOf(music(44100, 22000), 44100), null, 'full band');
});

test('verdicts', () => {
  const cd = { bits: 16, rate: 44100 };
  assert.equal(verdict(cd, { cutoff: null }).kind, 'real');
  assert.equal(verdict(cd, { cutoff: 16000 }).label, 'Fake: really ~128 kbps');
  assert.equal(verdict(cd, { cutoff: 18600 }).label, 'Fake: really ~192 kbps');
  assert.equal(verdict(cd, { cutoff: 19900 }).label, 'Fake: really ~320 kbps');
  assert.equal(verdict(cd, { cutoff: 20600 }).kind, 'real', 'high walls are common in genuine masters');
  assert.equal(lossySource(20400), null);
  assert.equal(verdict({ bits: 24, rate: 96000 }, { cutoff: 21600 }).kind, 'upsampled');
  assert.equal(verdict({ bits: 24, rate: 96000 }, { cutoff: null }).kind, 'real');
  assert.equal(verdict({ bits: 24, rate: 44100 }, { cutoff: null, padded: true }).kind, 'padded');
  assert.equal(verdict(cd, { cutoff: null, padded: true }).kind, 'real', 'padding is only asked of 24-bit files');
});

test('padded 24-bit: every sample a multiple of 256 steps', () => {
  const x = music(48000, 15000, { seconds: 1 });
  assert.equal(padded16([x.map((v) => Math.round(v * 32768) / 32768)], 24), true);
  assert.equal(padded16([x.map((v) => Math.round(v * 8388608) / 8388608)], 24), false);
});

// A minimal FLAC: fLaC, STREAMINFO, a VORBIS_COMMENT, a broken PICTURE (last), then "frames".
function fakeFlac({ rate = 96000, bits = 24, channels = 2 } = {}) {
  const si = new Uint8Array(34);
  si[10] = rate >> 12; si[11] = (rate >> 4) & 255;
  si[12] = ((rate & 15) << 4) | ((channels - 1) << 1) | ((bits - 1) >> 4);
  si[13] = ((bits - 1) & 15) << 4;
  si[17] = 100;
  const enc = new TextEncoder();
  const vendor = enc.encode('test');
  const c = [enc.encode('TITLE=Song'), enc.encode('ARTIST=Band')];
  const vlen = 4 + vendor.length + 4 + c.reduce((s, x) => s + 4 + x.length, 0);
  const vc = new Uint8Array(vlen);
  const dv = new DataView(vc.buffer);
  let p = 0;
  dv.setUint32(p, vendor.length, true); p += 4; vc.set(vendor, p); p += vendor.length;
  dv.setUint32(p, c.length, true); p += 4;
  for (const x of c) { dv.setUint32(p, x.length, true); p += 4; vc.set(x, p); p += x.length; }
  const pic = new Uint8Array(10).fill(0xff);
  const block = (type, body, last) => [new Uint8Array([(last ? 0x80 : 0) | type, body.length >> 16, (body.length >> 8) & 255, body.length & 255]), body];
  const parts = [enc.encode('fLaC'), ...block(0, si), ...block(4, vc), ...block(6, pic, true), new Uint8Array([0xff, 0xf8, 1, 2, 3])];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

test('FLAC header: what the file claims, tags, and a clean stream without the picture', () => {
  const f = parseFlac(fakeFlac());
  assert.equal(f.rate, 96000);
  assert.equal(f.bits, 24);
  assert.equal(f.channels, 2);
  assert.equal(f.samples, 100);
  assert.deepEqual(f.tags, { TITLE: 'Song', ARTIST: 'Band' });
  assert.equal(f.clean.length, 42 + 5);
  assert.equal(String.fromCharCode(...f.clean.subarray(0, 4)), 'fLaC');
  assert.equal(f.clean[4], 0x80, 'STREAMINFO marked as the last block');
  assert.deepEqual([...f.clean.subarray(42)], [0xff, 0xf8, 1, 2, 3]);
  const cd = parseFlac(fakeFlac({ rate: 44100, bits: 16 }));
  assert.equal(cd.rate, 44100);
  assert.equal(cd.bits, 16);
  assert.throws(() => parseFlac(new TextEncoder().encode('RIFF....')), /not a FLAC/);
});

test('WAV header', () => {
  const b = new Uint8Array(44);
  const dv = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WAVEfmt '), 8);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, 48000, true);
  dv.setUint16(34, 24, true);
  const w = parseWav(b);
  assert.deepEqual([w.rate, w.bits, w.channels], [48000, 24, 2]);
});
