// Keeps uploaded clips in this browser's own storage (IndexedDB) so a page refresh doesn't lose them, and deletes each
// one an hour after its last change. Nothing is uploaded: the files never leave the device.
//
// Everything here fails soft. Private browsing, a full disk, Safari evicting old data or a browser without IndexedDB
// just means clips aren't kept after a refresh; the app keeps working.

import { APP_ID } from "./app";

export const KEEP_MS = 60 * 60 * 1000;
let keepMs = KEEP_MS;
export const keepTime = () => keepMs;
/** for testing: shorten the hour */
export function setKeepTime(ms: number) {
  keepMs = ms;
}

export interface Kept {
  id: string;
  name: string;
  size: number;
  /** last change; the clip is deleted at savedAt + keepTime() */
  savedAt: number;
}

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((res) => {
    try {
      const rq = indexedDB.open(APP_ID, 1);
      rq.onupgradeneeded = () => {
        rq.result.createObjectStore("meta", { keyPath: "id" });
        rq.result.createObjectStore("files");
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch {
      res(null);
    }
  }));
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });

const mb = (n: number) => `${Math.round(n / 1e6).toLocaleString()} MB`;
let askedPersist = false;

export type KeepResult = { ok: true; savedAt: number } | { ok: false; reason: string };

/** Store a clip so it survives a refresh. */
export async function keepClip(id: string, file: File): Promise<KeepResult> {
  const d = await db();
  if (!d) return { ok: false, reason: "this browser isn't letting the page store files (private browsing?)" };
  try {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    if (est?.quota && est.usage !== undefined) {
      const free = est.quota - est.usage;
      if (file.size > free * 0.9) return { ok: false, reason: `too big to keep (${mb(file.size)}, about ${mb(free)} free)` };
    }
    if (!askedPersist) {
      askedPersist = true;
      navigator.storage?.persist?.().catch(() => false); // ask the browser not to evict it early
    }
    const savedAt = Date.now(), tx = d.transaction(["meta", "files"], "readwrite");
    tx.objectStore("files").put(file, id);
    tx.objectStore("meta").put({ id, name: file.name, size: file.size, savedAt } satisfies Kept);
    await done(tx);
    return { ok: true, savedAt };
  } catch (e: any) {
    void forget(id);
    return { ok: false, reason: e?.name === "QuotaExceededError" ? "not enough storage space to keep it" : `couldn't store it (${e?.message ?? e})` };
  }
}

/** Restart a clip's hour (call after each change). Returns the new savedAt, or null if it isn't stored. */
export async function touch(id: string): Promise<number | null> {
  const d = await db();
  if (!d) return null;
  try {
    const tx = d.transaction("meta", "readwrite"), st = tx.objectStore("meta");
    const m = (await req(st.get(id))) as Kept | undefined;
    if (!m) return null;
    m.savedAt = Date.now();
    st.put(m);
    await done(tx);
    return m.savedAt;
  } catch {
    return null;
  }
}

export async function forget(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(["meta", "files"], "readwrite");
    tx.objectStore("meta").delete(id);
    tx.objectStore("files").delete(id);
    await done(tx);
  } catch {
    /* nothing to do */
  }
}

export async function forgetAll(): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(["meta", "files"], "readwrite");
    tx.objectStore("meta").clear();
    tx.objectStore("files").clear();
    await done(tx);
  } catch {
    /* nothing to do */
  }
}

/** Delete everything past its hour (and any file without a record). Returns the ids that were deleted. */
export async function purgeExpired(now = Date.now()): Promise<string[]> {
  const d = await db();
  if (!d) return [];
  try {
    const tx = d.transaction(["meta", "files"], "readwrite"), meta = tx.objectStore("meta"), files = tx.objectStore("files");
    const all = (await req(meta.getAll())) as Kept[], fileIds = (await req(files.getAllKeys())) as string[];
    const live = new Set<string>(), gone: string[] = [];
    for (const m of all) {
      if (now - m.savedAt >= keepMs) {
        meta.delete(m.id);
        files.delete(m.id);
        gone.push(m.id);
      } else live.add(m.id);
    }
    for (const id of fileIds) if (!live.has(id) && !gone.includes(id)) files.delete(id);
    await done(tx);
    return gone;
  } catch {
    return [];
  }
}

/** Clips kept from an earlier visit, oldest first, after deleting expired ones. */
export async function restore(): Promise<{ meta: Kept; file: File }[]> {
  await purgeExpired();
  const d = await db();
  if (!d) return [];
  try {
    const tx = d.transaction(["meta", "files"], "readonly");
    const all = ((await req(tx.objectStore("meta").getAll())) as Kept[]).sort((a, b) => a.savedAt - b.savedAt);
    const out: { meta: Kept; file: File }[] = [], lost: string[] = [];
    for (const m of all) {
      const f = (await req(tx.objectStore("files").get(m.id))) as Blob | undefined;
      if (!f) lost.push(m.id); // e.g. Safari evicted it
      else out.push({ meta: m, file: f instanceof File ? f : new File([f], m.name, { type: f.type }) });
    }
    for (const id of lost) void forget(id);
    return out;
  } catch {
    return [];
  }
}
