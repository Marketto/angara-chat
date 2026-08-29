import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sampleRate = 44_100;
const tau = Math.PI * 2;

function envelope(t, attack, decay) {
  return Math.min(1, t / attack) * Math.exp(-t / decay);
}

function softClip(value) {
  return Math.tanh(value * 1.25) / Math.tanh(1.25);
}

function makeWav(duration, synth) {
  const count = Math.round(duration * sampleRate);
  const pcm = Buffer.alloc(count * 2);
  let peak = 0;
  const values = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    const value = softClip(synth(t, index));
    values[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  const gain = 0.82 / Math.max(peak, 0.001);
  for (let index = 0; index < count; index += 1) {
    pcm.writeInt16LE(Math.round(values[index] * gain * 32767), index * 2);
  }

  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function khomus(t) {
  const twang = envelope(t, 0.004, 0.23);
  const fundamental = 105 + 32 * (1 - Math.exp(-t * 8));
  let signal = 0;
  for (let harmonic = 1; harmonic <= 9; harmonic += 1) {
    const weight = harmonic === 1 ? 0.22 : 1 / Math.pow(harmonic, 0.72);
    const shimmer = 1 + 0.012 * Math.sin(tau * (3.1 + harmonic * 0.13) * t);
    signal += weight * Math.sin(tau * fundamental * harmonic * shimmer * t + harmonic * 0.31);
  }
  const ice = 0.2 * envelope(t, 0.01, 0.34) * Math.sin(tau * (2_250 + 430 * t) * t);
  const strike = t < 0.018 ? (1 - t / 0.018) * Math.sin(tau * 6_700 * t) : 0;
  return 0.72 * twang * signal + ice + 0.18 * strike;
}

function bowedNote(t, start, duration, frequency) {
  if (t < start || t > start + duration) return 0;
  const local = t - start;
  const release = Math.min(1, (duration - local) / 0.11);
  const bow = Math.min(1, local / 0.055) * release;
  const vibrato = 1 + 0.006 * Math.sin(tau * 5.2 * local);
  let tone = 0;
  for (let harmonic = 1; harmonic <= 7; harmonic += 1) {
    tone += Math.sin(tau * frequency * harmonic * vibrato * local + harmonic * 0.18)
      / Math.pow(harmonic, 1.35);
  }
  const texture = 0.025 * Math.sin(tau * 3_900 * local) * Math.sin(tau * 61 * local);
  return bow * (tone + texture);
}

function taiga(t) {
  const first = bowedNote(t, 0, 0.62, 220);
  const second = bowedNote(t, 0.48, 0.67, 293.66);
  const air = 0.018 * envelope(t, 0.12, 0.7) * Math.sin(tau * 1_730 * t + 0.8 * Math.sin(tau * 2.2 * t));
  return 0.46 * first + 0.52 * second + air;
}

function baikal(t) {
  const drumEnvelope = envelope(t, 0.003, 0.16);
  const drumPhase = tau * (98 * t - 31 * t * t);
  const drum = 0.85 * drumEnvelope * (Math.sin(drumPhase) + 0.28 * Math.sin(2 * drumPhase));
  const bellStart = 0.17;
  if (t < bellStart) return drum;
  const local = t - bellStart;
  const bellEnvelope = envelope(local, 0.002, 0.28);
  const bell = bellEnvelope * (
    0.68 * Math.sin(tau * 1_176 * local)
    + 0.31 * Math.sin(tau * 1_897 * local)
    + 0.18 * Math.sin(tau * 2_713 * local)
  );
  return drum + 0.62 * bell;
}

const sounds = [
  ['khomus-di-ghiaccio.wav', 0.86, khomus],
  ['arco-della-taiga.wav', 1.18, taiga],
  ['eco-del-baikal.wav', 0.94, baikal],
];

for (const [name, duration, synth] of sounds) {
  await writeFile(resolve(directory, name), makeWav(duration, synth));
  console.log(`Creato ${name}`);
}
