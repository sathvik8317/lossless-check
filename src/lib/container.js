// Reads what a FLAC or WAV file claims about itself, and for FLAC builds a
// clean stream ("fLaC" + STREAMINFO marked last + audio frames). Browsers
// refuse a whole FLAC over one malformed metadata block (seen in the wild: a
// PICTURE with a broken MIME type), and the cover art isn't needed anyway.

const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

function id3Size(b) {
  if (ascii(b, 0, 3) !== 'ID3') return 0;
  return 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
}

function vorbisComments(b, o, len) {
  const dv = new DataView(b.buffer, b.byteOffset + o, len);
  const dec = new TextDecoder();
  const tags = {};
  let p = 4 + dv.getUint32(0, true);
  const n = dv.getUint32(p, true);
  p += 4;
  for (let i = 0; i < n && p + 4 <= len; i++) {
    const l = dv.getUint32(p, true);
    p += 4;
    const s = dec.decode(b.subarray(o + p, o + p + l));
    p += l;
    const eq = s.indexOf('=');
    if (eq > 0) {
      const k = s.slice(0, eq).toUpperCase();
      if (!(k in tags)) tags[k] = s.slice(eq + 1);
    }
  }
  return tags;
}

// bytes: Uint8Array of the whole file.
// -> { format: 'flac', rate, bits, channels, samples, tags, clean: Uint8Array }
export function parseFlac(bytes) {
  const o = id3Size(bytes);
  if (ascii(bytes, o, 4) !== 'fLaC') throw new Error('not a FLAC file');
  let p = o + 4;
  let info = null;
  let tags = {};
  for (;;) {
    if (p + 4 > bytes.length) throw new Error('metadata runs past the end of the file');
    const last = bytes[p] & 0x80;
    const type = bytes[p] & 0x7f;
    const len = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    const body = p + 4;
    if (type === 0) {
      const s = bytes.subarray(body, body + 34);
      info = {
        rate: (s[10] << 12) | (s[11] << 4) | (s[12] >> 4),
        channels: ((s[12] >> 1) & 7) + 1,
        bits: (((s[12] & 1) << 4) | (s[13] >> 4)) + 1,
        samples: (s[13] & 15) * 2 ** 32 + ((s[14] << 24) >>> 0) + (s[15] << 16) + (s[16] << 8) + s[17],
      };
    } else if (type === 4) {
      try { tags = vorbisComments(bytes, body, len); } catch { tags = {}; }
    }
    p = body + len;
    if (last) break;
  }
  if (!info) throw new Error('no STREAMINFO block');
  const head = bytes.slice(o, o + 42);
  head[4] = 0x80; // STREAMINFO, last-metadata-block flag set
  const clean = new Uint8Array(42 + bytes.length - p);
  clean.set(head, 0);
  clean.set(bytes.subarray(p), 42);
  return { format: 'flac', ...info, tags, clean };
}

// -> { format: 'wav', rate, bits, channels, tags: {}, clean: bytes }
export function parseWav(bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') throw new Error('not a WAV file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = ascii(bytes, p, 4);
    const len = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      const fmt = dv.getUint16(p + 8, true);
      const extensible = fmt === 0xfffe;
      if (fmt !== 1 && !extensible) throw new Error('not integer PCM');
      return {
        format: 'wav',
        channels: dv.getUint16(p + 10, true),
        rate: dv.getUint32(p + 12, true),
        bits: dv.getUint16(p + 22, true),
        tags: {},
        clean: bytes,
      };
    }
    p += 8 + len + (len & 1);
  }
  throw new Error('no fmt chunk');
}

export function parseFile(name, bytes) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'flac') return parseFlac(bytes);
  if (ext === 'wav') return parseWav(bytes);
  throw new Error('only FLAC and WAV are checked');
}
