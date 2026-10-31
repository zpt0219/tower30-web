const DB = "tower30-web-v1",
  STORE = "saves";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE);
      if (!r.result.objectStoreNames.contains("workbench"))
        r.result.createObjectStore("workbench");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("无法打开存档数据库"));
  });
}
export async function readSaves(): Promise<{
  current?: string;
  backup?: string;
}> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"),
        store = tx.objectStore(STORE),
        a = store.get("current"),
        b = store.get("backup");
      tx.oncomplete = () =>
        resolve({
          current: typeof a.result === "string" ? a.result : undefined,
          backup: typeof b.result === "string" ? b.result : undefined,
        });
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function writeSave(
  json: string,
  keepBackup = false,
): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE),
        old = store.get("current");
      old.onsuccess = () => {
        if (!keepBackup && typeof old.result === "string")
          store.put(old.result, "backup");
        store.put(json, "current");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("存档事务中止"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readWorkbench(
  key: "draft" | "session",
): Promise<string | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workbench", "readonly"),
        r = tx.objectStore("workbench").get(key);
      tx.oncomplete = () =>
        resolve(typeof r.result === "string" ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function writeWorkbench(
  key: "draft" | "session",
  value: string,
): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workbench", "readwrite");
      tx.objectStore("workbench").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("工作台保存中止"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
