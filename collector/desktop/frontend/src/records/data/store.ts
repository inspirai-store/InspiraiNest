import type { LocalDraft, LocalRecord, RecordStore, StoredItem } from './types.ts';
export class IndexedRecordStore implements RecordStore {
  private opened: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB) {
    this.opened = new Promise((resolve, reject) => {
      const request = factory.open('inspirainest-capture-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('items')) request.result.createObjectStore('items', {keyPath:'id'}); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', mode); let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本机保存被中断'));
      try {const request=work(tx.objectStore('items'));request.onsuccess=()=>{result=request.result;};}catch(error){tx.abort();reject(error);}
    });
  }
  all() { return this.transaction<StoredItem[]>('readonly', s => s.getAll()); }
  get(id: string) { return this.transaction<StoredItem | undefined>('readonly', s => s.get(id)); }
  async put(item: StoredItem) { await this.transaction('readwrite', s => s.put(item)); }
  async commit(item: LocalRecord, draft: LocalDraft) { await this.transaction('readwrite', s => { s.put(item); return s.put(draft); }); }
}
