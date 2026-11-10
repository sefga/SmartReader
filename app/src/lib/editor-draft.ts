import { openDatabase } from './storage.ts';

export interface EditorDraft {
  id: string;
  title: string;
  text: string;
  autoSync: boolean;
  usesCurrentAudio: boolean;
  audioIdentity?: string;
  audioName?: string;
  updatedAt: number;
}

interface DraftMedia { audio?: File; timing?: File }
interface StoredDraft { draft: EditorDraft; audio?: File; timing?: File }

const LOCAL_KEY = 'reader-editor-draft';
const invalidated = new Set<string>();
let writes: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDraft(value: unknown): EditorDraft | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 256
    || typeof value.title !== 'string' || value.title.length > 150
    || typeof value.text !== 'string' || new TextEncoder().encode(value.text).byteLength > 2_000_000
    || typeof value.autoSync !== 'boolean' || typeof value.usesCurrentAudio !== 'boolean'
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
    || (value.audioIdentity !== undefined && (typeof value.audioIdentity !== 'string' || value.audioIdentity.length > 1024))
    || (value.audioName !== undefined && (typeof value.audioName !== 'string' || value.audioName.length > 255))) return undefined;
  return {
    id: value.id, title: value.title, text: value.text, autoSync: value.autoSync,
    usesCurrentAudio: value.usesCurrentAudio, updatedAt: value.updatedAt,
    ...(value.audioIdentity === undefined ? {} : { audioIdentity: value.audioIdentity as string }),
    ...(value.audioName === undefined ? {} : { audioName: value.audioName as string }),
  };
}

/** Проверяет локальный JSON, не принимая повреждённые поля и посторонние данные. */
export function parseEditorDraft(value: unknown): EditorDraft | undefined {
  if (typeof value !== 'string') return undefined;
  try { return validateDraft(JSON.parse(value)); } catch { return undefined; }
}

function localDraft(): EditorDraft | undefined {
  try {
    const value = parseEditorDraft(localStorage.getItem(LOCAL_KEY));
    return value && !invalidated.has(value.id) ? value : undefined;
  } catch { return undefined; }
}

/** Сохраняет текст синхронно; недоступное или переполненное хранилище не прерывает ввод. */
export function cacheEditorDraft(draft: EditorDraft): boolean {
  try {
    const checked = validateDraft(draft);
    if (!checked || invalidated.has(checked.id)) return false;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(checked));
    return true;
  } catch { return false; }
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = writes.then(operation);
  writes = next.catch(() => undefined);
  return next;
}

/** Обработчик транзакции остаётся синхронным, чтобы IndexedDB не закрыла её до записи. */
async function withStore<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore, setResult: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('reading', mode);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить черновик.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Операция с черновиком прервана.'));
      try { execute(transaction.objectStore('reading'), value => { result = value; }); }
      catch (cause) { transaction.abort(); reject(cause); }
    });
  } finally { database.close(); }
}

/** Не откатывает метаданные; явные вложения того же id применяет в порядке вызовов. */
export function saveEditorDraft(draft: EditorDraft, media?: DraftMedia): Promise<void> {
  const checked = validateDraft(draft);
  if (!checked) return Promise.reject(new Error('Не удалось сохранить повреждённый черновик.'));
  return enqueue(async () => {
    if (invalidated.has(checked.id)) return;
    await withStore<void>('readwrite', store => {
      if (invalidated.has(checked.id)) return;
      const request = store.get('editor-draft');
      request.onsuccess = () => {
        if (invalidated.has(checked.id)) return;
        const current = validateDraft(request.result);
        const newer = current && !invalidated.has(current.id) && current.updatedAt > checked.updatedAt;
        if (!newer) store.put(checked, 'editor-draft');
        if (media === undefined || (newer && current.id !== checked.id)) return;
        if (!media.audio && !media.timing) { store.delete('editor-media'); return; }
        const saved: Record<string, unknown> = { id: checked.id };
        for (const key of ['audio', 'timing'] as const) {
          const file = media[key];
          if (!file) continue;
          saved[key] = file;
          saved[`${key}Name`] = file.name;
          saved[`${key}Type`] = file.type;
          saved[`${key}LastModified`] = file.lastModified;
        }
        store.put(saved, 'editor-media');
      };
    });
  });
}

function restoreFile(media: Record<string, unknown>, key: 'audio' | 'timing'): File | undefined {
  const blob = media[key], name = media[`${key}Name`], type = media[`${key}Type`], lastModified = media[`${key}LastModified`];
  if (!(blob instanceof Blob) || typeof name !== 'string' || !name || name.length > 255) return undefined;
  return new File([blob], name, {
    type: typeof type === 'string' ? type : blob.type,
    lastModified: typeof lastModified === 'number' && Number.isFinite(lastModified) ? lastModified : Date.now(),
  });
}

/** Выбирает более свежий текст; при равном времени предпочитает локальный ввод. */
export async function loadEditorDraft(): Promise<StoredDraft | undefined> {
  await writes;
  let stored: { metadata: unknown; media: unknown } | undefined;
  try {
    stored = await withStore('readonly', (store, setResult) => {
      const result = { metadata: undefined as unknown, media: undefined as unknown };
      setResult(result);
      const metadata = store.get('editor-draft'), media = store.get('editor-media');
      metadata.onsuccess = () => { result.metadata = metadata.result; };
      media.onsuccess = () => { result.media = media.result; };
    });
  } catch { /* Локальный текст остаётся доступным при сбое IndexedDB. */ }
  const local = localDraft(), metadata = validateDraft(stored?.metadata);
  const persisted = metadata && !invalidated.has(metadata.id) ? metadata : undefined;
  const draft = !local || (persisted && persisted.updatedAt > local.updatedAt) ? persisted : local;
  if (!draft) return undefined;
  const result: StoredDraft = { draft };
  if (isRecord(stored?.media) && stored.media.id === draft.id) {
    const audio = restoreFile(stored.media, 'audio'), timing = restoreFile(stored.media, 'timing');
    if (audio) result.audio = audio;
    if (timing) result.timing = timing;
  }
  return result;
}

/** Сразу блокирует поздние сохранения id; другие черновики и данные приложения не удаляет. */
export function clearEditorDraft(id: string): Promise<void> {
  invalidated.add(id);
  try {
    if (parseEditorDraft(localStorage.getItem(LOCAL_KEY))?.id === id) localStorage.removeItem(LOCAL_KEY);
  } catch { /* Недоступный localStorage не препятствует очистке IndexedDB. */ }
  return enqueue(async () => {
    await withStore<void>('readwrite', store => {
      for (const key of ['editor-draft', 'editor-media']) {
        const request = store.get(key);
        request.onsuccess = () => { if (isRecord(request.result) && request.result.id === id) store.delete(key); };
      }
    });
  });
}
