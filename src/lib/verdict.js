// Turns the spectrum evidence into a verdict in plain words.
//
// Where a lossy encoder's low-pass sits says roughly what bitrate the source
// had (LAME: ~16 kHz at 128 kbps, ~18.6 at 192, ~20 at 320; calibrated with
// ffmpeg round trips). Above 20.4 kHz a wall is also common in genuine
// masters, so it doesn't count.
export const LOSSY_WALL = 20400;

export function lossySource(cutoff) {
  if (!cutoff || cutoff >= LOSSY_WALL) return null;
  if (cutoff < 17000) return '128';
  if (cutoff < 19000) return '192';
  return '320';
}

export const khz = (hz) => `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)} kHz`;

// info: { bits, rate }, src: { cutoff, step, padded }
// -> { kind: 'real' | 'lossy' | 'upsampled' | 'padded', label, why }
export function verdict(info, src) {
  const { bits, rate } = info;
  const hires = bits >= 24 || rate > 48000;
  const kbps = lossySource(src.cutoff);
  if (kbps) {
    return {
      kind: 'lossy',
      label: `Fake: really ~${kbps} kbps`,
      why: `No sound above ${khz(src.cutoff)}, the mark a ${kbps} kbps MP3/AAC leaves. Converting it to lossless can't bring back what was thrown away.`,
    };
  }
  if (hires && src.cutoff && rate > 48000 && src.cutoff <= 24500) {
    return {
      kind: 'upsampled',
      label: 'Fake Hi-Res: upsampled CD',
      why: `No sound above ${khz(src.cutoff)} in a ${khz(rate)} file, so it was upsampled from CD quality. Same sound as the CD, bigger file.`,
    };
  }
  if (hires && src.padded) {
    return {
      kind: 'padded',
      label: `Fake ${bits}-bit: 16-bit inside`,
      why: `Only 16 of the ${bits} bits carry sound; the rest are zeros.`,
    };
  }
  return {
    kind: 'real',
    label: hires ? 'Real Hi-Res' : 'Real lossless',
    why: src.cutoff
      ? `Full band up to ${khz(src.cutoff)}, where the format's own filter sits. No sign of a lossy source.`
      : 'Sound all the way up the spectrum. No sign of a lossy source.',
  };
}
