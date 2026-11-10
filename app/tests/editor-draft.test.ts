import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheEditorDraft, clearEditorDraft, loadEditorDraft, parseEditorDraft, saveEditorDraft, type EditorDraft } from '../src/lib/editor-draft.ts';

const draft: EditorDraft = { id: 'черновик', title: 'Новый заголовок', text: '# Статья\n\nИсправленный текст.', autoSync: false, usesCurrentAudio: true, audioIdentity: 'запись.mp3|123|30', updatedAt: 10 };
const originalIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Модель внешнего хранилища с атомарным commit и потерей File.name при клонировании. */
function setupStorage() {
  const local = new Map<string, string>();
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  let failWrites = false;
  const database = {
    close: () => {},
    transaction: (name: string, mode: IDBTransactionMode) => {
      assert.equal(name, 'reading');
      const staged: { key: string; value?: unknown; remove?: boolean }[] = [];
      let pending = 0, finished = false;
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string) => request(() => values.get(key)),
          put: (value: unknown, key: string) => request(() => {
            assert.equal(mode, 'readwrite');
            if (failWrites) throw new DOMException('Нет места', 'QuotaExceededError');
            staged.push({ key, value: structuredClone(value) });
          }),
          delete: (key: string) => request(() => {
            assert.equal(mode, 'readwrite');
            staged.push({ key, remove: true });
          }),
        }),
      };
      function complete(): void {
        queueMicrotask(() => {
          if (pending || finished) return;
          finished = true;
          for (const item of staged) {
            writes.push(item.key);
            if (item.remove) values.delete(item.key); else values.set(item.key, item.value);
          }
          tx.oncomplete?.();
        });
      }
      function request(action: () => unknown) {
        const result = { result: undefined as unknown, onsuccess: null as (() => void) | null };
        pending++;
        queueMicrotask(() => {
          if (finished) return;
          try { result.result = action(); result.onsuccess?.(); }
          catch (cause) { finished = true; tx.error = cause as DOMException; tx.onerror?.(); tx.onabort?.(); }
          pending--; complete();
        });
        return result;
      }
      complete();
      return tx;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { local.set(key, value); },
    removeItem: (key: string) => { local.delete(key); },
  } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: (name: string, version: number) => {
      assert.equal(name, 'text-and-voice'); assert.equal(version, 1);
      const request = { result: database, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  return { local, values, writes, setFailWrites: (value: boolean) => { failWrites = value; } };
}

afterEach(() => {
  for (const [name, descriptor] of [['indexedDB', originalIdb], ['localStorage', originalStorage]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

test('Черновик восстанавливает текст, заголовок и связь с текущим аудио', () => {
  assert.deepEqual(parseEditorDraft(JSON.stringify(draft)), draft);
});

test('Повреждённый черновик не перезаписывает материал и не вызывает падение формы', () => {
  for (const value of [null, '', '{', '[]', '{"text":"ввод"}', JSON.stringify({ ...draft, autoSync: 'да' }), JSON.stringify({ ...draft, usesCurrentAudio: 'да' })]) {
    assert.equal(parseEditorDraft(value), undefined);
  }
});

test('Валидатор отклоняет повреждённые поля и слишком большой текст, сохраняя длинное имя файла', () => {
  for (const patch of [{ id: '' }, { updatedAt: null }, { title: 1 }, { text: false }, { audioName: 2 }, { audioIdentity: false }, { title: 'я'.repeat(151) }, { text: 'я'.repeat(1_000_001) }]) {
    assert.equal(parseEditorDraft(JSON.stringify({ ...draft, ...patch })), undefined);
  }
  const named = { ...draft, audioName: `${'я'.repeat(251)}.mp3` };
  assert.deepEqual(parseEditorDraft(JSON.stringify(named)), named);
});

test('Синхронный cache восстанавливает текст даже при недоступной IndexedDB', async () => {
  const db = setupStorage();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => { throw new Error('Доступ запрещён'); } });
  assert.equal(cacheEditorDraft(draft), true);
  assert.equal(db.local.has('reader-editor-draft'), true);
  assert.deepEqual(await loadEditorDraft(), { draft });
});

test('Недоступный localStorage не вызывает падение cache или загрузки', async () => {
  setupStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Доступ запрещён'); } });
  assert.equal(cacheEditorDraft(draft), false);
  assert.equal(await loadEditorDraft(), undefined);
});

test('IndexedDB восстанавливает медиа с именами и MIME, а metadata-only save не переписывает Blob', async () => {
  const db = setupStorage();
  const audio = new File(['звук'], 'озвучка.m4a', { type: 'audio/mp4', lastModified: 123 });
  const timing = new File(['[]'], 'метки.json', { type: 'application/json', lastModified: 456 });
  await saveEditorDraft(draft, { audio, timing });
  const latest = { ...draft, text: 'Новый текст', updatedAt: 20 };
  cacheEditorDraft(latest);
  await saveEditorDraft(latest);
  const saved = await loadEditorDraft();
  assert.deepEqual(saved?.draft, latest);
  assert.equal(saved?.audio?.name, 'озвучка.m4a');
  assert.equal(saved?.audio?.type, 'audio/mp4');
  assert.equal(saved?.audio?.lastModified, 123);
  assert.equal(await saved?.audio?.text(), 'звук');
  assert.equal(saved?.timing?.name, 'метки.json');
  assert.equal(saved?.timing?.type, 'application/json');
  assert.equal(saved?.timing?.lastModified, 456);
  assert.equal(db.writes.filter(key => key === 'editor-media').length, 1);
});

test('При равных updatedAt локальные метаданные имеют приоритет, а медиа другого id не прикрепляется', async () => {
  setupStorage();
  await saveEditorDraft({ ...draft, updatedAt: 3 }, { audio: new File(['звук'], 'старый.mp3') });
  const other = { ...draft, id: 'другой', text: 'Несохранённый ввод', updatedAt: 3 };
  cacheEditorDraft(other);
  assert.deepEqual(await loadEditorDraft(), { draft: other });
});

test('После ошибки quota старый local cache не заменяет новый текст из IndexedDB', async () => {
  const db = setupStorage();
  cacheEditorDraft(draft);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => db.local.get(key) ?? null,
    setItem: () => { throw new DOMException('Нет места', 'QuotaExceededError'); },
  } });
  const latest = { ...draft, text: 'Последние изменения после переполнения localStorage', updatedAt: 20 };
  assert.equal(cacheEditorDraft(latest), false);
  await saveEditorDraft(latest);
  assert.deepEqual(await loadEditorDraft(), { draft: latest });
});

test('Позднее сохранение старых метаданных после нового media save не теряет текст при quota', async () => {
  const db = setupStorage();
  db.local.set('reader-editor-draft', JSON.stringify(draft));
  const latest = { ...draft, text: 'Новый текст с новым аудио', updatedAt: 20 };
  await saveEditorDraft(latest, { audio: new File(['новое аудио'], 'новое.mp3', { type: 'audio/mpeg' }) });
  await saveEditorDraft(draft);
  const saved = await loadEditorDraft();
  assert.deepEqual(saved?.draft, latest);
  assert.equal(saved?.audio?.name, 'новое.mp3');
});

test('Устаревший другой id не заменяет актуальные метаданные и аудио', async () => {
  setupStorage();
  const latest = { ...draft, id: 'актуальный', text: 'Текущая статья', updatedAt: 20 };
  await saveEditorDraft(latest, { audio: new File(['текущее аудио'], 'текущее.mp3') });
  await saveEditorDraft({ ...draft, id: 'другая-страница' }, { audio: new File(['старое аудио'], 'старое.mp3') });
  const saved = await loadEditorDraft();
  assert.deepEqual(saved?.draft, latest);
  assert.equal(saved?.audio?.name, 'текущее.mp3');
});

test('Явный возврат желаемого аудио не отменяется вместе с устаревшими метаданными того же id', async () => {
  setupStorage();
  const latest = { ...draft, text: 'Последняя правка текста', updatedAt: 20 };
  await saveEditorDraft(latest, { audio: new File(['B'], 'B.mp3') });
  await saveEditorDraft(draft, { audio: new File(['A'], 'A.mp3') });
  const saved = await loadEditorDraft();
  assert.deepEqual(saved?.draft, latest);
  assert.equal(saved?.audio?.name, 'A.mp3');
});

test('Явное удаление медиа того же id сохраняет более свежий текст', async () => {
  setupStorage();
  const latest = { ...draft, text: 'Последняя правка', updatedAt: 20 };
  await saveEditorDraft(latest, { audio: new File(['B'], 'B.mp3') });
  await saveEditorDraft(draft, {});
  assert.deepEqual(await loadEditorDraft(), { draft: latest });
});

test('При равном updatedAt новое сохранение может заменить метаданные', async () => {
  setupStorage();
  await saveEditorDraft(draft);
  const latest = { ...draft, title: 'Новое название в ту же миллисекунду' };
  await saveEditorDraft(latest);
  assert.deepEqual(await loadEditorDraft(), { draft: latest });
});

test('Повреждённый local metadata заменяется валидным IndexedDB fallback без потери медиа', async () => {
  const db = setupStorage();
  await saveEditorDraft(draft, { audio: new File(['звук'], 'запись.mp3', { type: 'audio/mpeg' }) });
  db.local.set('reader-editor-draft', '{');
  assert.deepEqual((await loadEditorDraft())?.draft, draft);
  assert.equal((await loadEditorDraft())?.audio?.name, 'запись.mp3');
});

test('Явно пустое media очищает вложения, сохраняя метаданные', async () => {
  setupStorage();
  await saveEditorDraft(draft, { audio: new File(['звук'], 'запись.mp3') });
  await saveEditorDraft(draft, {});
  assert.deepEqual(await loadEditorDraft(), { draft });
});

test('Очередь продолжает сохранять после ошибки записи', async () => {
  const db = setupStorage();
  db.setFailWrites(true);
  await assert.rejects(saveEditorDraft(draft));
  db.setFailWrites(false);
  const latest = { ...draft, text: 'После ошибки', updatedAt: 30 };
  await saveEditorDraft(latest);
  assert.deepEqual(await loadEditorDraft(), { draft: latest });
});

test('clear блокирует уже поставленный в очередь и поздний save старого id', async () => {
  setupStorage();
  const old = { ...draft, id: 'удаляемый' };
  cacheEditorDraft(old);
  const pending = saveEditorDraft(old, { audio: new File(['звук'], 'старый.mp3') });
  const clear = clearEditorDraft(old.id);
  const late = saveEditorDraft(old);
  assert.equal(cacheEditorDraft(old), false);
  await Promise.all([pending, clear, late]);
  assert.equal(await loadEditorDraft(), undefined);
});

test('clear чужого id не удаляет новый черновик, его медиа и другие данные приложения', async () => {
  const db = setupStorage();
  const current = { ...draft, id: 'сохраняемый' };
  const untouched = { marker: 'не трогать' };
  for (const key of ['current', 'last-capture', 'capture-journal']) db.values.set(key, untouched);
  cacheEditorDraft(current);
  await saveEditorDraft(current, { audio: new File(['звук'], 'новый.mp3') });
  await clearEditorDraft('старый');
  assert.deepEqual((await loadEditorDraft())?.draft, current);
  assert.equal((await loadEditorDraft())?.audio?.name, 'новый.mp3');
  for (const key of ['current', 'last-capture', 'capture-journal']) assert.equal(db.values.get(key), untouched);
});

test('Повреждённые данные IndexedDB не вызывают падение загрузки', async () => {
  const db = setupStorage();
  db.values.set('editor-draft', { id: 'сломанный', text: 123 });
  assert.equal(await loadEditorDraft(), undefined);
});
