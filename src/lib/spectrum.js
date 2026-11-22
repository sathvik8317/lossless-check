// Is a "lossless" file really lossless? Pure functions, run in the analysis worker.
//
// Lossy encoders throw away the top of the spectrum: LAME cuts everything above
// ~16 kHz at 128 kbps, ~19 kHz at 192 kbps and ~20 kHz at 320 kbps. Converting
// that MP3 to FLAC keeps the hole, so a FLAC with a brick wall well below the
// Nyquist frequency was made from a lossy file. Real recordings roll off
// gradually, or only at the CD's own anti-alias filter (~21-22 kHz).
//
// The same wall exposes fake Hi-Res: a 96 kHz file upsampled from a CD has
// nothing above ~22 kHz. And a "24-bit" file padded from 16-bit has its lowest
// 8 bits all zero.
import { stft } from './fft.js';

const SIZE = 8192;
const FRAMES = 200;
const BAND = 100; // Hz per band of the smoothed spectrum

// Power-averaged spectrum in dB, over up to FRAMES frames spread across the
// song (silent frames skipped). Returns { bands: dB per BAND Hz, bandHz }.
export function averageSpectrum(mono, rate) {
  const total = Math.floor((mono.length - SIZE) / SIZE);
  const hop = SIZE * Math.max(1, Math.floor(total / FRAMES));
  const power = new Float64Array(SIZE / 2 + 1);
  let used = 0;
  stft(mono, SIZE, hop, (mag) => {
    let e = 0;
    for (let k = 1; k < mag.length; k++) e += mag[k] * mag[k];
    if (e < 1e-6) return; // silence
    for (let k = 0; k < mag.length; k++) power[k] += mag[k] * mag[k];
    used++;
  });
  const binHz = rate / SIZE;
  const n = Math.floor(rate / 2 / BAND);
  const bands = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    const k0 = Math.ceil((b * BAND) / binHz);
    const k1 = Math.min(power.length - 1, Math.floor(((b + 1) * BAND) / binHz));
    let p = 0;
    for (let k = k0; k <= k1; k++) p += power[k];
    p /= Math.max(1, k1 - k0 + 1) * Math.max(1, used);
    bands[b] = 10 * Math.log10(p + 1e-20);
  }
  return { bands, bandHz: BAND, frames: used };
}

const mean = (a, i0, i1) => {
  let s = 0, n = 0;
  for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i]; n++; }
  return n ? s / n : -200;
};

// The lowest brick wall above 11 kHz: { cutoff (Hz), step (dB) }, or cutoff
// null. A wall is a sharp step (most of it within 1 kHz) down onto a flat
// floor: after a lossy encoder's low-pass only noise is left (dither, or the
// clipping of a hot master), which is flat, while real music keeps sloping and
// wobbling. Walls within ~1.3 kHz of Nyquist are the format's own anti-alias
// filter and are ignored.
export const MIN_STEP = 12;
const FLAT = 4; // dB, max spread of the floor (or a quarter of the step, if bigger)
export function findCutoff({ bands, bandHz }) {
  const b = (hz) => Math.round(hz / bandHz);
  const last = bands.length - 1;
  let best = 0;
  for (let i = b(11000); i <= last - b(1300); i++) {
    const r0 = i + b(800), r1 = Math.min(last, i + b(2600));
    const floor = mean(bands, r0, r1);
    let lo = Infinity, hi = -Infinity;
    for (let k = r0; k < r1; k++) { lo = Math.min(lo, bands[k]); hi = Math.max(hi, bands[k]); }
    const below = mean(bands, i - b(600), i - b(200));
    const step = below - floor;
    best = Math.max(best, step);
    if (step < MIN_STEP || hi - lo > Math.max(FLAT, step / 4)) continue;
    if (bands[i - b(200)] - bands[i + b(800)] < 0.7 * step) continue; // gradual, not a wall
    // Refine: the first band past the midpoint level.
    const mid = below - step / 2;
    let k = i - b(200);
    while (k < i + b(800) && bands[k] > mid) k++;
    return { cutoff: k * bandHz, step: round1(step) };
  }
  return { cutoff: null, step: round1(best) };
}
const round1 = (v) => Math.round(v * 10) / 10;

// For a 24-bit file: true when every probed sample is a multiple of 256, i.e.
// the file holds 16-bit audio with zero padding. Needs a lossless decode at the
// file's own rate (any resampling makes this return false, never a false alarm).
export function padded16(channels, bitDepth) {
  if (bitDepth !== 24) return false;
  let seen = 0;
  for (const c of channels) {
    const step = Math.max(1, Math.floor(c.length / 20000));
    for (let i = 0; i < c.length; i += step) {
      const v = c[i];
      if (v === 0) continue;
      const n = Math.round(v * 8388608);
      if (Math.abs(v * 8388608 - n) > 1e-3 || n % 256 !== 0) return false;
      seen++;
    }
  }
  return seen >= 1000;
}

// Everything the quality grade needs, stored with the analysis.
export function authenticity(channels, mono, rate, bitDepth) {
  const { cutoff, step } = findCutoff(averageSpectrum(mono, rate));
  return { cutoff, step, rate, padded: padded16(channels, bitDepth) };
}
