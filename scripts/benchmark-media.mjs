// Explicit opt-in benchmark: generates synthetic media in a temporary directory.
// node scripts/benchmark-media.mjs /path/to/ffmpeg
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run } from '../server/core.mjs';
import { chooseBoundary } from '../server/streaming.mjs';
const ffmpeg = process.argv[2] || 'ffmpeg';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vietstudio-media-bench-'));
try {
  const source = path.join(dir, 'synthetic.mp4'), duration = 95;
  const began = performance.now();
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=95', '-f', 'lavfi', '-i',
    'aevalsrc=if(between(mod(t\\,40)\\,38\\,42)\\,0\\,0.15*sin(2*PI*440*t)):s=16000:d=95',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', source]);
  const generationMs = performance.now() - began, segments = [];
  for (let start = 0; start < duration;) {
    const offset = Math.max(0, start - 1), target = Math.min(duration, start + 45);
    const length = Math.min(duration, target + 5) - offset, output = path.join(dir, `${segments.length}.wav`);
    let log = ''; const tick = performance.now();
    await run(ffmpeg, ['-y', '-ss', String(offset), '-i', source, '-t', String(length), '-vn', '-ar', '16000', '-ac', '1',
      '-af', 'silencedetect=noise=-45dB:d=0.35', '-c:a', 'pcm_s16le', output], { onLine: line => { log += line; } });
    const end = chooseBoundary(log, start, target, offset, duration), wav = await fs.readFile(output);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    let dataBytes = 0;
    for (let p = 12; p + 8 <= wav.length;) {
      const size = wav.readUInt32LE(p + 4);
      if (wav.toString('ascii', p, p + 4) === 'data') { dataBytes = size; break; }
      p += 8 + size + (size % 2);
    }
    assert.ok(Math.abs(dataBytes / 32000 - length) < .15, 'PCM window duration must match extraction');
    segments.push({ start, end, audioSeconds: dataBytes / 32000, wallMs: Math.round(performance.now() - tick) });
    assert.ok(end > start); start = end;
  }
  assert.ok(segments[0].end >= 38 && segments[0].end <= 40.1, 'First cut should follow synthetic pause');
  console.log(JSON.stringify({ kind: 'real FFmpeg, synthetic media; no ASR/translation/GPU inference', platform: `${process.platform}/${process.arch}`,
    mediaSeconds: duration, generationMs: Math.round(generationMs), extractionMs: segments.reduce((n,s)=>n+s.wallMs,0), segments }, null, 2));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
