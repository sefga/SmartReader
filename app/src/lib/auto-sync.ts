import { alignRecognizedWords, type AlignmentResult } from './alignment.ts';
import { parseText, type ReadingDocument } from './sync.ts';

export interface SyncProgress { stage: 'loading' | 'decoding' | 'transcribing' | 'refining' | 'done'; progress: number }

export async function synchronizeAudio(document: ReadingDocument, audio: Blob, signal: AbortSignal, onProgress: (progress: SyncProgress) => void): Promise<AlignmentResult & { boundaryWarning: boolean }> {
  signal.throwIfAborted();
  const { BrowserWhisper } = await import('browser-whisper');
  signal.throwIfAborted();
  const isRussian = /\p{Script=Cyrillic}/u.test(document.text);
  const model = new BrowserWhisper({ model: 'whisper-base_timestamped', ...(isRussian ? { language: 'ru' } : {}) });
  const file = audio instanceof File ? audio : new File([audio], document.audioName || 'audio', { type: audio.type });
  let activeStream: { cancel: () => void } | undefined;
  const cancel = () => { activeStream?.cancel(); model.dispose(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const stream = model.transcribe(file, { onProgress: progress => { if (progress.stage !== 'done') onProgress(progress); } });
    activeStream = stream;
    const segments = await stream.collect();
    signal.throwIfAborted();
    const words = segments.flatMap(segment => segment.words || []);
    const textWords = parseText(document.text).words;
    const original = alignRecognizedWords(textWords, words, document.duration);
    try {
      const { refineChunkBoundaries } = await import('./boundary-sync');
      const refined = await refineChunkBoundaries(model, audio, words, document.duration, signal, next => { activeStream = next; }, progress => onProgress({ stage: 'refining', progress }));
      signal.throwIfAborted();
      return { ...alignRecognizedWords(textWords, refined, document.duration), boundaryWarning: false };
    } catch {
      signal.throwIfAborted();
      return { ...original, boundaryWarning: true };
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    model.dispose();
  }
}
