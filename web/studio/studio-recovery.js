const DB_NAME = "comfypencil-studio";
const DB_VERSION = 1;
const STORE_NAME = "recovery-drafts";

let openDatabasePromise = null;

function getIndexedDb() {
  return globalThis.indexedDB || null;
}

function openDatabase() {
  if (openDatabasePromise) {
    return openDatabasePromise;
  }

  const indexedDb = getIndexedDb();
  if (!indexedDb) {
    return Promise.resolve(null);
  }

  openDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Failed to open ComfyPencil recovery storage."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  }).catch((error) => {
    openDatabasePromise = null;
    throw error;
  });

  return openDatabasePromise;
}

function runStoreOperation(mode, callback) {
  return openDatabase().then((database) => {
    if (!database) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = callback(store);
      if (!request) {
        resolve(null);
        return;
      }
      request.onerror = () => reject(request.error || new Error("ComfyPencil recovery storage failed."));
      request.onsuccess = () => resolve(request.result ?? null);
    });
  });
}

export function getRecoveryDraftKey({ nodeId, documentId } = {}) {
  const normalizedDocumentId = String(documentId || "").trim();
  if (normalizedDocumentId) {
    return `document:${normalizedDocumentId}`;
  }
  const normalizedNodeId = String(nodeId || "").trim();
  if (normalizedNodeId) {
    return `node:${normalizedNodeId}`;
  }
  return "";
}

export function buildRecoveryDraftDocument(snapshot) {
  if (!snapshot?.document || !Array.isArray(snapshot.document.layers)) {
    return null;
  }

  return {
    ...snapshot.document,
    layers: snapshot.document.layers.map((layer) => {
      const payload = snapshot.layers?.[layer.id] || {};
      return {
        ...layer,
        dataUrl: typeof payload.color === "string" ? payload.color : "",
        materialDataUrl: typeof payload.material === "string" ? payload.material : "",
      };
    }),
  };
}

export function shouldOfferRecoveryDraft(document, draft) {
  if (!document?.id || !draft?.snapshot?.document) {
    return false;
  }

  const snapshotDocument = draft.snapshot.document;
  if (String(snapshotDocument.id || "") !== String(document.id || "")) {
    return false;
  }

  const savedAt = Date.parse(draft.savedAt || 0) || 0;
  const documentUpdatedAt = Date.parse(document.updatedAt || 0) || 0;
  const sourceRevision = Number(draft.sourceRevision || 0);
  const currentRevision = Number(document.revision || 0);
  return savedAt >= documentUpdatedAt || sourceRevision >= currentRevision;
}

export async function loadRecoveryDraft(scope) {
  const primaryKey = getRecoveryDraftKey(scope);
  if (!primaryKey) {
    return null;
  }
  const primary = await runStoreOperation("readonly", (store) => store.get(primaryKey));
  if (primary) {
    return primary;
  }

  const fallbackKey = scope?.documentId
    ? getRecoveryDraftKey({ nodeId: scope.nodeId })
    : getRecoveryDraftKey({ documentId: scope.documentId });
  if (!fallbackKey || fallbackKey === primaryKey) {
    return null;
  }
  return runStoreOperation("readonly", (store) => store.get(fallbackKey));
}

export async function saveRecoveryDraft({
  nodeId,
  documentId,
  documentName,
  sourceRevision,
  snapshot,
}) {
  const key = getRecoveryDraftKey({ nodeId, documentId });
  if (!key || !snapshot?.document) {
    return null;
  }

  const draft = {
    id: key,
    nodeId: String(nodeId || ""),
    documentId: String(documentId || ""),
    documentName: String(documentName || snapshot.document.name || "Untitled Sketch"),
    sourceRevision: Number(sourceRevision || snapshot.document.revision || 0),
    savedAt: new Date().toISOString(),
    snapshot,
  };
  await runStoreOperation("readwrite", (store) => store.put(draft));
  return draft;
}

export async function clearRecoveryDraft(scope) {
  const key = getRecoveryDraftKey(scope);
  if (!key) {
    return;
  }
  await runStoreOperation("readwrite", (store) => store.delete(key));
}
