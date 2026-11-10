import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureJournal, loadCaptureJournal, clearCaptureJournal } from '../src/lib/capture-journal.ts';

type Key = string | (string | number)[];
interface Range { lower: Key; upper: Key }
const originalIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const originalRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
const originalReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');

/** Изолированная модель транзакций: данные становятся видимыми только после commit. */
function fakeDatabase() {
  const values = new Map<string, { key: Key; value: unknown }>();
  const writes: { key: Key; value: unknown }[] = [];
  const opens: { name: string; version: number }[] = [];
  let failWrites = false;
  const keyOf = (key: Key) => JSON.stringify(key);
  const inRange = (key: Key, range: Range) => Array.isArray(key) && Array.isArray(range.lower) && Array.isArray(range.upper)
    && key[0] === range.lower[0] && key[1] === range.lower[1] && Number(key[2]) >= Number(range.lower[2]) && Number(key[2]) <= Number(range.upper[2]);
  const database = {
    close: () => {},
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      assert.equal(storeName, 'reading');
      const pendingWrites: { key: Key; value?: unknown; delete?: boolean }[] = [];
      let pending = 0, failed = false, finished = false;
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
        abort: () => { if (finished || failed) return; failed = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore: () => ({
          get: (key: Key) => request(() => values.get(keyOf(key))?.value),
          getAll: (range: Range) => request(() => [...values.values()].filter(item => inRange(item.key, range)).sort((a, b) => Number((a.key as unknown[])[2]) - Number((b.key as unknown[])[2])).map(item => item.value)),
          put: (value: unknown, key: Key) => request(() => {
            assert.equal(mode, 'readwrite');
            if (failWrites) throw new DOMException('Нет места', 'QuotaExceededError');
            pendingWrites.push({ key, value });
            return key;
          }),
          delete: (key: Key | Range) => request(() => {
            if (typeof key === 'object' && !Array.isArray(key) && 'lower' in key) {
              for (const item of values.values()) if (inRange(item.key, key)) pendingWrites.push({ key: item.key, delete: true });
            } else pendingWrites.push({ key: key as Key, delete: true });
          }),
        }),
      };
      function complete(): void {
        queueMicrotask(() => {
          if (pending || failed || finished) return;
          finished = true;
          for (const item of pendingWrites) {
            if (item.delete) values.delete(keyOf(item.key));
            else { values.set(keyOf(item.key), { key: item.key, value: item.value }); writes.push({ key: item.key, value: item.value }); }
          }
          tx.oncomplete?.();
        });
      }
      function request(action: () => unknown) {
        const result = { result: undefined as unknown, error: null as DOMException | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        pending++;
        queueMicrotask(() => {
          if (failed) return;
          try { result.result = action(); result.onsuccess?.(); }
          catch (cause) { failed = true; tx.error = cause as DOMException; result.error = tx.error; result.onerror?.(); tx.onerror?.(); tx.onabort?.(); }
          pending--; complete();
        });
        return result;
      }
      complete();
      return tx;
    },
  };
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { bound: (lower: Key, upper: Key) => ({ lower, upper }) } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: (name: string, version: number) => {
      opens.push({ name, version });
      const request = { result: database, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  return { values, writes, opens, setFailWrites: (value: boolean) => { failWrites = value; } };
}

afterEach(() => {
  for (const [name, descriptor] of [['indexedDB', originalIdb], ['IDBKeyRange', originalRange], ['FileReader', originalReader]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

test('Журнал пишет каждый chunk отдельно и восстанавливает полный файл без обновления схемы БД', async () => {
  const db = fakeDatabase();
  const journal = createCaptureJournal();
  const first = journal.append(new Blob(['первый'], { type: 'audio/webm;codecs=opus' }), 1000);
  const second = journal.append(new Blob(['второй'], { type: 'audio/webm;codecs=opus' }), 2300);
  await Promise.all([first, second]);
  const saved = await loadCaptureJournal();
  assert.ok(saved);
  assert.equal(await saved.file.text(), 'первыйвторой');
  assert.equal(saved.elapsedMs, 2300);
  assert.equal(saved.sessionId, journal.sessionId);
  assert.match(saved.file.name, /\.webm$/u);
  const chunks = db.writes.filter(item => Array.isArray(item.key));
  assert.deepEqual(chunks.map(item => (item.key as Key[])[2]), [0, 1]);
  assert.deepEqual(chunks.map(item => (item.value as Blob).size), [12, 12]);
  assert.ok(db.opens.every(item => item.name === 'text-and-voice' && item.version === 1));
});

test('clear ждёт очередь и не оставляет последний chunk после явной отмены', async () => {
  fakeDatabase();
  const journal = createCaptureJournal();
  void journal.append(new Blob(['первый'], { type: 'audio/webm' }), 1000);
  void journal.append(new Blob(['последний'], { type: 'audio/webm' }), 2000);
  await journal.clear();
  assert.equal(await loadCaptureJournal(), undefined);
});

test('Пустой журнал не перезаписывает существующий last-capture', async () => {
  const db = fakeDatabase();
  const saved = new Blob(['предыдущая запись']);
  db.values.set(JSON.stringify('last-capture'), { key: 'last-capture', value: saved });
  const journal = createCaptureJournal();
  await journal.append(new Blob([]), 0);
  await journal.clear();
  assert.equal(await loadCaptureJournal(), undefined);
  assert.equal(db.values.get(JSON.stringify('last-capture'))?.value, saved);
});

test('Сбой транзакции сохраняет уже записанный префикс и не допускает дыр в chunks', async () => {
  const db = fakeDatabase();
  const journal = createCaptureJournal();
  await journal.append(new Blob(['целый'], { type: 'audio/webm' }), 1000);
  db.setFailWrites(true);
  await assert.rejects(journal.append(new Blob(['потерянный'], { type: 'audio/webm' }), 2000));
  db.setFailWrites(false);
  await assert.rejects(journal.append(new Blob(['последующий'], { type: 'audio/webm' }), 3000));
  const saved = await loadCaptureJournal();
  assert.ok(saved);
  assert.equal(await saved.file.text(), 'целый');
  assert.equal(saved.elapsedMs, 1000);
});

test('Другая вкладка не перезаписывает незавершённый журнал и last-capture', async () => {
  fakeDatabase();
  const first = createCaptureJournal();
  await first.append(new Blob(['защищённый'], { type: 'audio/webm' }), 1000);
  const second = createCaptureJournal();
  await assert.rejects(second.append(new Blob(['другой'], { type: 'audio/webm' }), 2000));
  await second.clear();
  const saved = await loadCaptureJournal();
  assert.equal(saved?.sessionId, first.sessionId);
  assert.equal(await saved?.file.text(), 'защищённый');
});

test('Удаление восстановленного журнала не затрагивает завершённую запись', async () => {
  const db = fakeDatabase();
  const saved = { audio: new Blob(['готовый MP3']), name: 'готовый.mp3' };
  db.values.set(JSON.stringify('last-capture'), { key: 'last-capture', value: saved });
  const journal = createCaptureJournal();
  await journal.append(new Blob(['исходник'], { type: 'audio/webm' }), 1000);
  await clearCaptureJournal(journal.sessionId);
  assert.equal(await loadCaptureJournal(), undefined);
  assert.equal(db.values.get(JSON.stringify('last-capture'))?.value, saved);
});

test('Повреждённый набор chunks отклоняется без удаления сохранившихся данных', async () => {
  const db = fakeDatabase();
  const journal = createCaptureJournal();
  await journal.append(new Blob(['один'], { type: 'audio/webm' }), 1000);
  await journal.append(new Blob(['два'], { type: 'audio/webm' }), 2000);
  db.values.delete(JSON.stringify(['capture', journal.sessionId, 0]));
  await assert.rejects(loadCaptureJournal(), /поврежд|фрагмент/iu);
  assert.ok(db.values.has(JSON.stringify(['capture', journal.sessionId, 1])));
});

test('Восстановленный WebM получает фактическую длительность последнего сохранённого фрагмента', async () => {
  fakeDatabase();
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  } });
  // Минимальный Segment/Info с TimecodeScale 1 мс и без Duration.
  const header = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x8c, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
  const journal = createCaptureJournal();
  await journal.append(new Blob([header], { type: 'audio/webm' }), 4321);
  const restored = await loadCaptureJournal();
  assert.ok(restored);
  const bytes = new Uint8Array(await restored.file.arrayBuffer());
  const durationIndex = bytes.findIndex((value, index) => value === 0x44 && bytes[index + 1] === 0x89 && bytes[index + 2] === 0x88);
  assert.ok(durationIndex >= 0, 'Восстановленный контейнер должен содержать Duration');
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getFloat64(durationIndex + 3), 4321);
});
