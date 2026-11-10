import { fixWebmDuration } from '@fix-webm-duration/fix';

export const MAX_RECORDING_BYTES = 150_000_000;
export type RecordingChunkHandler = (chunk: Blob, elapsedMs: number) => void | Promise<void>;
export interface AudioRecording {
  result: Promise<{ file: File; warning?: string; partial?: boolean }>;
  flush: () => void;
  stop: () => void;
  cancel: () => void;
}

export function recordAudioStream(stream: MediaStream, onTime: (seconds: number) => void, onChunk?: RecordingChunkHandler): AudioRecording {
  const release = (): void => stream.getTracks().forEach(track => track.stop());
  const audioTracks = stream.getAudioTracks().filter(track => track.readyState === 'live');
  if (!audioTracks.length) {
    release();
    throw new Error('Звук не передан. Выберите вкладку Chrome/Edge и включите «Поделиться аудио вкладки».');
  }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    release();
    throw new Error('Запись WebM не поддерживается. Откройте читалку в актуальном Chrome или Edge.');
  }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType, audioBitsPerSecond: 128_000 }); }
  catch (cause) { release(); throw cause; }
  const chunks: Blob[] = [];
  let size = 0;
  let cancelled = false;
  let failure: Error | undefined;
  let limitReached = false;
  let lastDataAt = 0;
  let endedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let persistence = Promise.resolve();
  let persistenceFailed = false;
  const startedAt = performance.now();
  const stop = (): void => {
    if (recorder.state !== 'inactive') { endedAt = performance.now(); recorder.stop(); }
  };
  const cleanup = (): void => {
    clearInterval(timer);
    stream.getTracks().forEach(track => track.removeEventListener('ended', stop));
    release();
  };
  const result = new Promise<{ file: File; warning?: string; partial?: boolean }>((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      if (size + event.data.size > MAX_RECORDING_BYTES - 1024) {
        limitReached = true;
        stop(); return;
      }
      size += event.data.size;
      chunks.push(event.data);
      lastDataAt = performance.now();
      const elapsedMs = (endedAt || lastDataAt) - startedAt;
      // Ошибка IndexedDB не останавливает MediaRecorder: исходник остаётся в памяти для скачивания.
      persistence = persistence.then(() => onChunk?.(event.data, elapsedMs)).then(() => undefined).catch(() => { persistenceFailed = true; });
    };
    recorder.onerror = () => { failure = new Error('Браузер прервал запись звука. Попробуйте выбрать вкладку заново.'); stop(); };
    recorder.onstop = async () => {
      const durationMs = (limitReached ? lastDataAt : endedAt || performance.now()) - startedAt;
      cleanup();
      await persistence;
      if (cancelled) { reject(new DOMException('Запись отменена.', 'AbortError')); return; }
      if (failure && !chunks.length) { reject(failure); return; }
      if (!chunks.length || (durationMs < 250 && !failure)) { reject(new Error('Запись слишком короткая. Запишите хотя бы секунду звука.')); return; }
      const blob = new Blob(chunks, { type: mimeType });
      // MediaRecorder не записывает длительность WebM; добавляем её для перемотки и повторного импорта.
      fixWebmDuration(blob, durationMs, { logger: false }).then(fixed => {
        if (cancelled) { reject(new DOMException('Запись отменена.', 'AbortError')); return; }
        if (fixed.size > MAX_RECORDING_BYTES) { reject(new Error('Запись превысила 150 МБ.')); return; }
        const warning = [
          failure?.message,
          failure ? 'Доступен частичный исходник. Скачайте его вручную.' : undefined,
          limitReached ? 'Достигнут лимит 150 МБ. Сохранён начальный фрагмент; оставшуюся часть запишите отдельно.' : undefined,
          persistenceFailed ? 'Не удалось сохранить промежуточную запись в браузере. Скачайте исходник вручную.' : undefined,
        ].filter(Boolean).join(' ') || undefined;
        resolve({ file: new File([fixed], `запись-${new Date().toISOString().replace(/[:.]/gu, '-')}.webm`, { type: mimeType }), warning, ...(failure ? { partial: true } : {}) });
      }).catch(reject);
    };
    stream.getTracks().forEach(track => track.addEventListener('ended', stop, { once: true }));
    try {
      recorder.start(1000);
      timer = setInterval(() => onTime((performance.now() - startedAt) / 1000), 1000);
    } catch (cause) { cleanup(); reject(cause); }
  });
  return {
    result, stop,
    flush: () => { if (recorder.state === 'recording') { try { recorder.requestData(); } catch { /* Между проверкой и вызовом источник мог завершиться. */ } } },
    cancel: () => { cancelled = true; stop(); },
  };
}

export async function captureTabAudio(onTime: (seconds: number) => void, onChunk?: RecordingChunkHandler): Promise<AudioRecording> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Запись вкладки доступна в Chrome/Edge на компьютере через HTTPS или localhost.');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: true });
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if (surface && surface !== 'browser') {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('Выберите отдельную вкладку браузера вместо всего экрана или окна.');
  }
  return recordAudioStream(stream, onTime, onChunk);
}
