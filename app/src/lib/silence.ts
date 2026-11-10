import type { WordCue } from './sync.ts';

export interface AudioRange { start: number; end: number }
export interface SilenceOptions { signal?: AbortSignal; onProgress?: (value: number) => void }

const WINDOW_SECONDS = 0.02;
const MIN_SILENCE_SECONDS = 1.2;
const EDGE_SECONDS = 0.12;
const SILENCE_RMS = 10 ** (-50 / 20);

export function validateSilences(ranges: AudioRange[], duration: number): AudioRange[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Не удалось определить длительность аудио.');
  let previousEnd = 0;
  return ranges.map(({ start, end }) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end > duration + 0.05) {
      throw new Error('Некорректные интервалы пауз.');
    }
    previousEnd = Math.min(duration, end);
    return { start, end: previousEnd };
  });
}

export function createTimeMapper(ranges: AudioRange[]): (time: number) => number {
  const removed = [0];
  for (const range of ranges) removed.push(removed.at(-1)! + range.end - range.start);
  return (time: number): number => {
    let low = 0, high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ranges[middle].end <= time) low = middle + 1; else high = middle;
    }
    const current = ranges[low];
    return Math.max(0, time - removed[low] - (current && time > current.start ? time - current.start : 0));
  };
}

export function silenceEndAt(ranges: AudioRange[], time: number): number | undefined {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle].end <= time) low = middle + 1; else high = middle;
  }
  return ranges[low] && ranges[low].start <= time ? ranges[low].end : undefined;
}

export function remapCuesAfterSilence(cues: WordCue[], ranges: AudioRange[], duration: number): { cues: WordCue[]; duration: number } {
  const checked = validateSilences(ranges, duration);
  const map = createTimeMapper(checked);
  const result = cues.map(cue => ({ ...cue, start: map(cue.start), end: map(cue.end) }));
  if (result.some(cue => cue.end <= cue.start)) throw new Error('Не удалось сохранить подсветку после удаления пауз. Сначала выполните автоматическую синхронизацию или сохраните оригинал.');
  return { cues: result, duration: map(duration) };
}

export async function detectSilences(source: Blob, duration: number, { signal, onProgress }: SilenceOptions = {}): Promise<AudioRange[]> {
  signal?.throwIfAborted();
  if (!Number.isFinite(duration) || duration <= 0 || !source.size) throw new Error('Не удалось определить длительность аудио.');
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const ranges: AudioRange[] = [];
  let sum = 0, count = 0, windowStart = 0, windowEnd = 0, silentStart: number | undefined, audibleSeconds = 0;
  let previousEnd = 0;
  const endSilent = (end: number): void => {
    if (silentStart !== undefined && end - silentStart >= MIN_SILENCE_SECONDS) {
      const start = Math.max(0, silentStart + EDGE_SECONDS);
      const finish = Math.min(duration, end - EDGE_SECONDS);
      if (finish > start) ranges.push({ start, end: finish });
    }
    silentStart = undefined;
  };
  const finishWindow = (): void => {
    if (!count) return;
    if (Math.sqrt(sum / count) < SILENCE_RMS) silentStart ??= windowStart;
    else { endSilent(windowStart); audibleSeconds += windowEnd - windowStart; }
    sum = 0;count = 0;
  };
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('В файле не найдена звуковая дорожка.');
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        signal?.throwIfAborted();
        if (sample.timestamp > previousEnd + 0.1) {finishWindow();endSilent(previousEnd);}
        const channels = Array.from({ length: sample.numberOfChannels }, (_, channel) => {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
          return data;
        });
        const stride = Math.max(1, Math.floor(sample.sampleRate / 12_000));
        for (let frame = 0; frame < sample.numberOfFrames; frame += stride) {
          const time = sample.timestamp + frame / sample.sampleRate;
          if (time < 0 || time >= duration) continue;
          if (!count) windowStart = time;
          let peak = 0;
          for (const channel of channels) peak = Math.max(peak, Math.abs(channel[frame]));
          sum += peak * peak;count++;
          windowEnd = Math.min(duration, sample.timestamp + Math.min(sample.numberOfFrames, frame + stride) / sample.sampleRate);
          if (windowEnd - windowStart >= WINDOW_SECONDS) finishWindow();
        }
        previousEnd = Math.max(previousEnd, Math.min(duration, sample.timestamp + sample.duration));
        onProgress?.(Math.min(1, previousEnd / duration));
      } finally {sample.close();}
    }
    finishWindow();endSilent(previousEnd);
    signal?.throwIfAborted();
    return audibleSeconds < 0.25 ? [] : validateSilences(ranges, duration);
  } finally {input.dispose();}
}
