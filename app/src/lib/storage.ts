import type { ReadingDocument } from './sync';
export interface SavedReading { document: ReadingDocument; audio?: Blob; exact: boolean }
// Прежнее имя базы сохраняет доступ к материалам после переименования в SmartReader.
const DB_NAME = 'text-and-voice';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=> {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => request.result.createObjectStore('reading');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Хранилище занято другой вкладкой.'));
  });
}

export async function loadReading(): Promise<SavedReading | undefined> {
  const database = await openDatabase();
  return new Promise((resolve,reject)=> {
    const transaction = database.transaction('reading','readonly');
    const request = transaction.objectStore('reading').get('current');
    request.onsuccess = () => resolve(request.result as SavedReading | undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => {database.close();reject(transaction.error);};
  });
}

export async function saveReading(value: SavedReading): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve,reject)=> {
    const transaction = database.transaction('reading','readwrite');
    transaction.objectStore('reading').put(value,'current');
    transaction.oncomplete = () => {database.close();resolve();};
    transaction.onerror = () => {database.close();reject(transaction.error);};
    transaction.onabort = () => {database.close();reject(transaction.error);};
  });
}
