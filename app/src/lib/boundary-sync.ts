import type { BrowserWhisper, TranscribePCMStream } from 'browser-whisper';
import { normalize, type RecognizedWord } from './alignment.ts';

export function mergeBoundaryWords(words: RecognizedWord[], heard: RecognizedWord[], boundary: number, duration: number): { words: RecognizedWord[]; matched: number } {
  const refined = words.map(word => ({ ...word }));
  const used = new Set<number>();
  let matched = 0;
  for (let wordIndex = 0; wordIndex < refined.length; wordIndex++) {
    const original = refined[wordIndex];
    if (original.start >= boundary + 1.5 || original.end <= boundary - 1.5) continue;
    const center = (original.start + original.end) / 2;
    let best = -1, distance = 1.5;
    for (let candidate = 0; candidate < heard.length; candidate++) {
      const item = heard[candidate];
      const difference = Math.abs((item.start + item.end) / 2 - center);
      if (!used.has(candidate) && normalize(item.text) === normalize(original.text) && difference < distance) {best = candidate;distance = difference;}
    }
    if (best < 0) continue;
    const candidate = heard[best];
    const wordStart = Math.max(candidate.start, refined[wordIndex - 1]?.end ?? 0);
    const wordEnd = Math.min(candidate.end, refined[wordIndex + 1]?.start ?? duration);
    if (wordEnd > wordStart) {
      refined[wordIndex] = { ...original, start: wordStart, end: wordEnd };
      used.add(best);matched++;
    }
  }
  return { words: refined, matched };
}

export async function refineChunkBoundaries(
  model: BrowserWhisper,
  audio: Blob,
  words: RecognizedWord[],
  duration: number,
  signal: AbortSignal,
  setStream: (stream: TranscribePCMStream) => void,
  onProgress: (progress: number) => void,
): Promise<RecognizedWord[]> {
  const boundaries: number[] = [];
  for (let boundary = 30; boundary < duration; boundary += 30) {
    if (words.some(word => word.start < boundary + 1.5 && word.end > boundary - 1.5)) boundaries.push(boundary);
  }
  if (!boundaries.length) return words;
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS });
  let refined = words.map(word => ({ ...word }));
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('Не найдена звуковая дорожка.');
    const sink = new AudioBufferSink(track);
    for (let index = 0; index < boundaries.length; index++) {
      signal.throwIfAborted();
      onProgress(index / boundaries.length);
      const boundary = boundaries[index];
      const start = Math.max(0, boundary - 4), end = Math.min(duration, boundary + 4);
      const context = new OfflineAudioContext(1, Math.ceil((end - start) * 16_000), 16_000);
      let hasAudio = false;
      for await (const wrapped of sink.buffers(start, end)) {
        signal.throwIfAborted();
        const offset = Math.max(0, start - wrapped.timestamp);
        const when = Math.max(0, wrapped.timestamp - start);
        const length = Math.min(wrapped.buffer.duration - offset, end - start - when);
        if (length <= 0) continue;
        const source = context.createBufferSource();
        source.buffer = wrapped.buffer;
        source.connect(context.destination);
        source.start(when, offset, length);
        hasAudio = true;
      }
      if (!hasAudio) throw new Error('Не удалось прочитать фрагмент записи.');
      const rendered = await context.startRendering();
      signal.throwIfAborted();
      const stream = model.transcribePCM(rendered.getChannelData(0));
      setStream(stream);
      const segments = await stream.collect();
      signal.throwIfAborted();
      const heard = segments.flatMap(segment => segment.words || []).map(word => ({ ...word, start: word.start + start, end: word.end + start }));
      const merged = mergeBoundaryWords(refined, heard, boundary, duration);
      if (!merged.matched) throw new Error('Не удалось уточнить слова на стыке фрагментов.');
      refined = merged.words;
    }
    onProgress(1);
    return refined;
  } finally { input.dispose(); }
}
