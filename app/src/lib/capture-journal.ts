import { fixWebmDuration } from '@fix-webm-duration/fix';
import { openDatabase } from './storage.ts';
import { MAX_RECORDING_BYTES } from './recording.ts';

export interface CaptureJournal {
  readonly sessionId: string;
  append(chunk: Blob, elapsedMs: number): Promise<void>;
  settle(): Promise<void>;
  clear(): Promise<void>;
}
export interface RecoveredCapture { file: File; elapsedMs: number; sessionId: string }

interface CaptureMetadata {
  sessionId: string;
  chunkCount: number;
  elapsedMs: number;
  size: number;
  mimeType: string;
  name: string;
  createdAt: number;
}

const METADATA_KEY = 'capture-journal';

function chunkRange(sessionId: string, lastIndex = Number.MAX_SAFE_INTEGER): IDBKeyRange {
  return IDBKeyRange.bound(['capture', sessionId, 0], ['capture', sessionId, lastIndex]);
}

/** Завершает операцию только после commit; chunks и метаданные меняются атомарно. */
async function writeJournal(action: (store: IDBObjectStore, abort: (error: Error) => void) => void): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let transaction: IDBTransaction;
    try { transaction = database.transaction('reading', 'readwrite'); }
    catch (cause) { database.close(); reject(cause); return; }
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(failure || transaction.error || new Error('Не удалось сохранить журнал записи.')); };
    const abort = (error: Error): void => { failure = error; transaction.abort(); };
    try { action(transaction.objectStore('reading'), abort); }
    catch (cause) { abort(cause instanceof Error ? cause : new Error('Не удалось сохранить журнал записи.')); }
  });
}

/** Создаёт последовательный журнал без накопительных копий полного аудио. */
export function createCaptureJournal(): CaptureJournal {
  const sessionId = crypto.randomUUID();
  const createdAt = Date.now();
  const name = `незавершённая-запись-${new Date(createdAt).toISOString().replace(/[:.]/gu, '-')}.webm`;
  let queue = Promise.resolve();
  let chunkCount = 0, size = 0, previousElapsed = 0;
  let closed = false;
  return {
    sessionId,
    append(chunk, elapsedMs) {
      if (closed) return Promise.reject(new Error('Журнал записи уже закрыт.'));
      if (!chunk.size) return queue;
      queue = queue.then(async () => {
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs < previousElapsed || size + chunk.size > MAX_RECORDING_BYTES) {
          throw new Error('Некорректный фрагмент промежуточной записи.');
        }
        const metadata: CaptureMetadata = { sessionId, chunkCount: chunkCount + 1, elapsedMs, size: size + chunk.size, mimeType: chunk.type || 'audio/webm', name, createdAt };
        await writeJournal((store, abort) => {
          const request = store.get(METADATA_KEY);
          request.onsuccess = () => {
            const current = request.result as Partial<CaptureMetadata> | undefined;
            if ((current && (current.sessionId !== sessionId || current.chunkCount !== chunkCount)) || (!current && chunkCount > 0)) {
              abort(new Error('В браузере есть другая незавершённая запись. Сначала прикрепите или скачайте её.')); return;
            }
            store.put(chunk, ['capture', sessionId, chunkCount]);
            store.put(metadata, METADATA_KEY);
          };
        });
        chunkCount++; size += chunk.size; previousElapsed = elapsedMs;
      });
      // Обработчик нужен и при pagehide, когда вызывающая страница уже не может показать ошибку.
      void queue.catch(() => undefined);
      return queue;
    },
    settle: () => queue,
    async clear() {
      closed = true;
      await queue.catch(() => undefined);
      await clearCaptureJournal(sessionId);
    },
  };
}

function isMetadata(value: unknown): value is CaptureMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<CaptureMetadata>;
  return typeof item.sessionId === 'string' && item.sessionId.length > 0 && item.sessionId.length < 100
    && typeof item.chunkCount === 'number' && Number.isInteger(item.chunkCount) && item.chunkCount > 0 && item.chunkCount <= 1_000_000
    && typeof item.elapsedMs === 'number' && Number.isFinite(item.elapsedMs) && item.elapsedMs > 0
    && typeof item.size === 'number' && Number.isFinite(item.size) && item.size > 0 && item.size <= MAX_RECORDING_BYTES
    && typeof item.mimeType === 'string' && item.mimeType.startsWith('audio/webm')
    && typeof item.name === 'string' && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt);
}

/** Собирает файл один раз при восстановлении и исправляет длительность по последнему сохранённому chunk. */
export async function loadCaptureJournal(): Promise<RecoveredCapture | undefined> {
  const database = await openDatabase();
  const saved = await new Promise<{ metadata: CaptureMetadata; chunks: Blob[] } | undefined>((resolve, reject) => {
    let metadata: CaptureMetadata | undefined, chunks: Blob[] | undefined, failure: Error | undefined;
    let transaction: IDBTransaction;
    try { transaction = database.transaction('reading', 'readonly'); }
    catch (cause) { database.close(); reject(cause); return; }
    transaction.oncomplete = () => { database.close(); resolve(metadata && chunks ? { metadata, chunks } : undefined); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(failure || transaction.error || new Error('Не удалось прочитать незавершённую запись.')); };
    const store = transaction.objectStore('reading');
    const request = store.get(METADATA_KEY);
    request.onsuccess = () => {
      if (request.result === undefined) return;
      if (!isMetadata(request.result)) {
        failure = new Error('Журнал незавершённой записи повреждён.'); transaction.abort(); return;
      }
      metadata = request.result;
      const all = store.getAll(chunkRange(metadata.sessionId, metadata.chunkCount - 1));
      all.onsuccess = () => { chunks = all.result as Blob[]; };
    };
  });
  if (!saved) return undefined;
  const { metadata, chunks } = saved;
  if (chunks.length !== metadata.chunkCount || chunks.some(chunk => !(chunk instanceof Blob) || !chunk.size)
    || chunks.reduce((sum, chunk) => sum + chunk.size, 0) !== metadata.size) {
    throw new Error('Сохранились не все фрагменты записи. Журнал повреждён; данные оставлены в браузере.');
  }
  const fixed = await fixWebmDuration(new Blob(chunks, { type: metadata.mimeType }), metadata.elapsedMs, { logger: false });
  return { sessionId: metadata.sessionId, elapsedMs: metadata.elapsedMs, file: new File([fixed], metadata.name, { type: metadata.mimeType, lastModified: metadata.createdAt }) };
}

/** Удаляет только указанную сессию, сохраняя last-capture и журнал другой вкладки. */
export async function clearCaptureJournal(sessionId: string): Promise<void> {
  await writeJournal(store => {
    store.delete(chunkRange(sessionId));
    const request = store.get(METADATA_KEY);
    request.onsuccess = () => {
      if ((request.result as Partial<CaptureMetadata> | undefined)?.sessionId === sessionId) store.delete(METADATA_KEY);
    };
  });
}
