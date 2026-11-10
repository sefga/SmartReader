import type { ReadingDocument } from './sync';
export interface SavedReading { document: ReadingDocument; audio?: Blob; exact: boolean }
// Прежнее имя базы сохраняет доступ к материалам после переименования в speechread.
const DB_NAME = 'text-and-voice';

export function openDatabase(): Promise<IDBDatabase> {
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

let readingWrites: Promise<void> = Promise.resolve();

export function saveReading(value: SavedReading): Promise<void> {
  const operation=readingWrites.then(async()=>{
    const database = await openDatabase();
    return new Promise<void>((resolve,reject)=> {
      const transaction = database.transaction('reading','readwrite');
      transaction.objectStore('reading').put(value,'current');
      transaction.oncomplete = () => {database.close();resolve();};
      transaction.onerror = () => {database.close();reject(transaction.error);};
      transaction.onabort = () => {database.close();reject(transaction.error);};
    });
  });
  readingWrites=operation.catch(()=>undefined);
  return operation;
}

export async function saveCapturedAudio(file: File): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve,reject)=> {
    const transaction = database.transaction('reading','readwrite');
    transaction.objectStore('reading').put({ audio:file, name:file.name, lastModified:file.lastModified },'last-capture');
    transaction.oncomplete = () => {database.close();resolve();};
    transaction.onerror = () => {database.close();reject(transaction.error);};
    transaction.onabort = () => {database.close();reject(transaction.error);};
  });
}

export async function loadCapturedAudio(): Promise<File | undefined> {
  const database = await openDatabase();
  return new Promise((resolve,reject)=> {
    const transaction = database.transaction('reading','readonly');
    const request = transaction.objectStore('reading').get('last-capture');
    request.onsuccess = () => {
      const value = request.result as {audio?:unknown;name?:unknown;lastModified?:unknown} | undefined;
      if (!value) {resolve(undefined);return;}
      if (!(value.audio instanceof Blob) || typeof value.name !== 'string') {reject(new Error('Не удалось восстановить последнюю запись.'));return;}
      resolve(new File([value.audio],value.name,{type:value.audio.type,lastModified:typeof value.lastModified === 'number' ? value.lastModified : Date.now()}));
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => {database.close();reject(transaction.error);};
  });
}
