import type { Candle, ChartDrawing, Timeframe, Trade } from "./types";

const DB_NAME = "nq-backtester";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const DATASET_STORE = "datasets";

export const ACTIVE_SNAPSHOT_ID = "active";

export type BacktesterSourceType = "real" | "demo" | "empty";

export type SavedBacktesterDataset = {
  id: string;
  label: string;
  sourceType: Exclude<BacktesterSourceType, "empty">;
  candles: Candle[];
  barCount: number;
  rangeStart: number | null;
  rangeEnd: number | null;
  createdAt: number;
  updatedAt: number;
};

export type SavedBacktesterSnapshot = {
  id: typeof ACTIVE_SNAPSHOT_ID;
  schemaVersion: 1;
  datasetId: string | null;
  updatedAt: number;
  sourceLabel: string;
  sourceType: BacktesterSourceType;
  status: string;
  timeframe: Timeframe;
  replayTime: number | null;
  speed: number;
  contracts: number;
  stopPoints: number;
  targetPoints: number;
  pendingNote: string;
  trades: Trade[];
  drawings: ChartDrawing[];
  showEma9: boolean;
  showEma20: boolean;
  showEma50: boolean;
  showVwap: boolean;
  showRsi: boolean;
  showVolume: boolean;
  magnetEnabled?: boolean;
};

export type SavedBacktesterSession = {
  snapshot: SavedBacktesterSnapshot | null;
  dataset: SavedBacktesterDataset | null;
};

export function createBacktesterDatasetId(
  label: string,
  sourceType: Exclude<BacktesterSourceType, "empty">,
  candles: Candle[],
) {
  const first = candles[0]?.time ?? 0;
  const last = candles.at(-1)?.time ?? 0;
  const seed = `${sourceType}|${label}|${candles.length}|${first}|${last}`;

  return `dataset-${hashString(seed)}`;
}

export async function loadBacktesterSession(): Promise<SavedBacktesterSession> {
  const db = await openBacktesterDb();

  try {
    const snapshot = await getFromStore<SavedBacktesterSnapshot>(db, SNAPSHOT_STORE, ACTIVE_SNAPSHOT_ID);
    const dataset = snapshot?.datasetId
      ? await getFromStore<SavedBacktesterDataset>(db, DATASET_STORE, snapshot.datasetId)
      : null;

    return {
      snapshot: snapshot ?? null,
      dataset: dataset ?? null,
    };
  } finally {
    db.close();
  }
}

export async function saveBacktesterDataset(dataset: SavedBacktesterDataset) {
  const db = await openBacktesterDb();

  try {
    const tx = db.transaction(DATASET_STORE, "readwrite");
    tx.objectStore(DATASET_STORE).put(dataset);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function saveBacktesterSnapshot(snapshot: SavedBacktesterSnapshot) {
  const db = await openBacktesterDb();

  try {
    const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
    tx.objectStore(SNAPSHOT_STORE).put(snapshot);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function clearBacktesterStorage() {
  const db = await openBacktesterDb();

  try {
    const tx = db.transaction([SNAPSHOT_STORE, DATASET_STORE], "readwrite");
    tx.objectStore(SNAPSHOT_STORE).clear();
    tx.objectStore(DATASET_STORE).clear();
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

function openBacktesterDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database could not be opened."));
  });
}

function getFromStore<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${storeName}.`));
  });
}

function waitForTransaction(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Local database transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Local database transaction was aborted."));
  });
}

function hashString(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
