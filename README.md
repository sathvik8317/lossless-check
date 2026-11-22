# Lossless Check

Finds "lossless" FLAC and WAV files that were really made from a lossy file, plus fake Hi-Res. One HTML page; everything runs in the browser and no file is uploaded.

| Verdict | How it's spotted |
| --- | --- |
| Fake: really ~128 / 192 / 320 kbps | A sharp spectral wall onto a flat floor below 20.4 kHz (LAME cuts at ~16 / ~18.6 / ~20 kHz) |
| Fake Hi-Res: upsampled CD | A 88.2 kHz+ file with a wall at or below 24.5 kHz |
| Fake 24-bit: 16-bit inside | Every sample of a 24-bit file is a multiple of 256 |

The detector is the one from Tonearm (`spectrum.js`, `pcm.js`, `fft.js`, copied unchanged).

## Use
- `npm run build`, then open `dist/lossless-check.html` (works from disk) and choose or drop a folder.
- Click a row to see its average spectrum with the wall marked. Export CSV for the full table.

## Checked
- `npm test`: 5 unit tests (wall finding, verdicts, padding, FLAC/WAV headers).
- `node tools/e2e.mjs out.json <folder>`: runs the built page in headless Chrome.
  - ffmpeg fixtures: 128 / 192 / 320 kbps round trips, padded 24-bit and a SoX-upsampled 96 kHz file are all caught; the real CD, WAV and a FLAC with a broken PICTURE block pass as real.
  - A real 99-file library: 4 fakes in 72 s, the same 4 Tonearm found.

## Known limits
- LAME V0 and AAC 256 leave no wall: not detectable (they sound close to lossless anyway).
- Walls at 20.4 kHz and above are never flagged, since many genuine masters have one there.
- ffmpeg's default resampler on a very loud (clipping) master leaves a sloped, noisy top end instead of a wall, so that upsample is missed. SoX-style upsampling is caught.
- FLAC and WAV only. Files over 600 MB are skipped (the whole song is decoded in memory).
