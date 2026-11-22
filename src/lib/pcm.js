// Exact PCM after browser decoding.
//
// Chromium converts decoded integer samples to float asymmetrically: negative
// values are divided by 2^(b-1) but positive ones by 2^(b-1) - 1 (found while
// testing Tonearm: hashing a decoded 16-bit FLAC only matched ffmpeg's PCM when
// positives were scaled back by 32767). Nothing is lost, but every positive
// sample is ~0.003% too big, so a 16-bit sample above half scale lands one step
// off when Windows converts the float back to integers.
//
// canonicalize() detects the divisor each sign actually used and rewrites
// the samples to the standard int / 2^(b-1), the representation ffmpeg, DAWs
// and Web Audio's own maths assume. It only acts when every probed sample is
// an exact integer step under one divisor, i.e. a lossless, unresampled
// decode; anything else (MP3, a resampled buffer) is left alone.
const PROBE = 4000;

// float32 can't hold s/32767 exactly, so allow 0.01 of a step for 16-bit. For
// 24-bit the asymmetry (~5e-10) is below float32 resolution: the values already
// sit on the exact grid, so only the standard divisor is checked, tightly.
function detect(chs, sign, scale, bits) {
  const cands = bits === 16 ? [scale, scale - 1] : [scale];
  const tol = bits === 16 ? 0.01 : 1e-6;
  const ok = [0, 0];
  let seen = 0;
  outer: for (const c of chs) {
    const step = Math.max(1, Math.floor(c.length / (PROBE * 4)));
    for (let i = 0; i < c.length; i += step) {
      const v = c[i];
      if (sign > 0 ? v <= 0 : v >= 0) continue;
      seen++;
      for (let k = 0; k < cands.length; k++) {
        const x = Math.abs(v) * cands[k];
        if (Math.abs(x - Math.round(x)) < tol) ok[k]++;
      }
      if (seen >= PROBE) break outer;
    }
  }
  if (seen < 50) return null;
  // Prefer the standard divisor when both fit (tiny values fit either).
  if (ok[0] === seen) return cands[0];
  if (cands.length > 1 && ok[1] === seen) return cands[1];
  return undefined; // not integer-aligned: lossy or resampled
}

// chs: Float32Arrays (modified in place). bits: source bit depth (16 or 24).
// -> { exact: bool, changed: number of samples rewritten, posDivisor, negDivisor }
export function canonicalize(chs, bits) {
  if (!(bits === 16 || bits === 24) || !chs.length) return { exact: false, changed: 0 };
  const scale = 2 ** (bits - 1);
  const pos = detect(chs, 1, scale, bits);
  const neg = detect(chs, -1, scale, bits);
  if (pos === undefined || neg === undefined) return { exact: false, changed: 0 };
  const pd = pos ?? scale, nd = neg ?? scale;
  let changed = 0;
  if (pd !== scale || nd !== scale) {
    for (const c of chs) {
      for (let i = 0; i < c.length; i++) {
        const v = c[i];
        const d = v > 0 ? pd : nd;
        if (d === scale) continue;
        const fixed = Math.round(v * d) / scale;
        if (fixed !== v) { c[i] = fixed; changed++; }
      }
    }
  }
  return { exact: true, changed, posDivisor: pd, negDivisor: nd };
}

// FNV-1a over 16-bit little-endian interleaved samples (for tests and checks).
export function pcm16Hash(chs) {
  let h = 0x811c9dc5;
  const n = chs[0].length;
  for (let i = 0; i < n; i++) {
    for (const c of chs) {
      const s = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32768)));
      const u = s & 0xffff;
      h ^= u & 255; h = Math.imul(h, 0x01000193) >>> 0;
      h ^= u >> 8; h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}
