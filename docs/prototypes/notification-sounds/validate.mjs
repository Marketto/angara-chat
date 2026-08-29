import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const samples = [
  ['khomus-di-ghiaccio.wav', 0.7, 1.0],
  ['arco-della-taiga.wav', 0.9, 1.3],
  ['eco-del-baikal.wav', 0.75, 1.1],
];

const hashes = new Set();

for (const [name, minimumDuration, maximumDuration] of samples) {
  const wav = await readFile(resolve(directory, name));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', `${name}: header RIFF mancante`);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE', `${name}: formato WAVE mancante`);
  assert.equal(wav.readUInt16LE(22), 1, `${name}: deve essere mono`);
  assert.equal(wav.readUInt32LE(24), 44_100, `${name}: sample rate inatteso`);
  assert.equal(wav.readUInt16LE(34), 16, `${name}: deve essere PCM a 16 bit`);

  const dataLength = wav.readUInt32LE(40);
  const duration = dataLength / 2 / 44_100;
  assert.ok(
    duration >= minimumDuration && duration <= maximumDuration,
    `${name}: durata ${duration.toFixed(2)}s fuori intervallo`,
  );

  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) {
    peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  }
  assert.ok(peak > 3_000, `${name}: segnale troppo debole`);
  assert.ok(peak < 32_767, `${name}: segnale in clipping`);

  hashes.add(createHash('sha256').update(wav).digest('hex'));
  console.log(`OK ${name}: ${duration.toFixed(2)}s, picco ${(peak / 32767).toFixed(2)}`);
}

assert.equal(hashes.size, samples.length, 'I tre campioni devono essere diversi');
