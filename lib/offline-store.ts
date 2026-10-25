"use client";

export type AttendancePayload = {
  member_id: string;
  department_id: string;
  activity_id: string | null;
  event_date: string;
  statut_presence: "present" | "absent";
};
export type OfflineAttendanceSnapshot<T> = { userId: string; savedAt: string; data: T };
export type PendingAttendance = { id: string; userId: string; createdAt: string; payload: AttendancePayload };

const DB_NAME = "silo-offline-v1";
const SNAPSHOTS = "attendance-snapshots";
const OUTBOX = "attendance-outbox";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Stockage hors ligne indisponible."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "userId" });
      if (!db.objectStoreNames.contains(OUTBOX)) {
        const store = db.createObjectStore(OUTBOX, { keyPath: "id" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Stockage hors ligne indisponible."));
  });
}

export async function saveAttendanceSnapshot<T>(userId: string, data: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    tx.objectStore(SNAPSHOTS).put({ userId, savedAt: new Date().toISOString(), data });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function readAttendanceSnapshot<T>(userId: string): Promise<OfflineAttendanceSnapshot<T> | null> {
  const db = await openDatabase();
  const value = await new Promise<OfflineAttendanceSnapshot<T> | undefined>((resolve, reject) => {
    const request = db.transaction(SNAPSHOTS, "readonly").objectStore(SNAPSHOTS).get(userId);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  db.close();
  if (!value) return null;
  if (Date.now() - new Date(value.savedAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
    const cleanupDb = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = cleanupDb.transaction(SNAPSHOTS, "readwrite");
      tx.objectStore(SNAPSHOTS).delete(userId);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    cleanupDb.close();
    return null;
  }
  return value;
}

export async function queueAttendance(entry: PendingAttendance): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, "readwrite"); tx.objectStore(OUTBOX).put(entry);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function readAttendanceQueue(userId: string): Promise<PendingAttendance[]> {
  const db = await openDatabase();
  const rows = await new Promise<PendingAttendance[]>((resolve, reject) => {
    const request = db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).index("userId").getAll(userId);
    request.onsuccess = () => resolve(request.result ?? []); request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeQueuedAttendance(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, "readwrite"); tx.objectStore(OUTBOX).delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function clearOfflineUserData(userId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOTS, OUTBOX], "readwrite");
    tx.objectStore(SNAPSHOTS).delete(userId);
    const request = tx.objectStore(OUTBOX).index("userId").openCursor(IDBKeyRange.only(userId));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  db.close();
}
