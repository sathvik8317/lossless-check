// In-place iterative radix-2 FFT on separate real/imag Float64Arrays.
// Twiddles and the bit-reversal table are cached per size.
const cache = new Map();

function plan(n) {
  let p = cache.get(n);
  if (p) return p;
  if (n & (n - 1)) throw new Error('FFT size must be a power of two');
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  p = { rev, cos, sin };
  cache.set(n, p);
  return p;
}

export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// Magnitude spectra of successive frames: calls onFrame(mag, frameIndex) with
// mag of length size/2+1 (reused buffer, copy it if you keep it).
export function stft(signal, size, hop, onFrame) {
  const win = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2 + 1);
  let f = 0;
  for (let start = 0; start + size <= signal.length; start += hop, f++) {
    for (let i = 0; i < size; i++) {
      re[i] = signal[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    onFrame(mag, f);
  }
  return f;
}
