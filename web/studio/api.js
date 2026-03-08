import { api } from "/scripts/api.js";

import { API_PREFIX } from "./constants.js";

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function requestJson(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const response = await api.fetchApi(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function createDocument(payload) {
  const data = await requestJson(`${API_PREFIX}/documents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.document;
}

export async function loadDocument(documentId) {
  const data = await requestJson(`${API_PREFIX}/documents/${encodeURIComponent(documentId)}`, {
    method: "GET",
  });
  return data.document;
}

export async function saveDocument(documentId, document, layerImages) {
  const colorLayerImages = {};
  const layerMaterialImages = {};
  Object.entries(layerImages || {}).forEach(([layerId, payload]) => {
    if (typeof payload === "string") {
      colorLayerImages[layerId] = payload;
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    const colorPayload = typeof payload.color === "string"
      ? payload.color
      : (typeof payload.image === "string" ? payload.image : "");
    const materialPayload = typeof payload.material === "string" ? payload.material : "";
    if (colorPayload) {
      colorLayerImages[layerId] = colorPayload;
    }
    if (materialPayload) {
      layerMaterialImages[layerId] = materialPayload;
    }
  });
  const data = await requestJson(`${API_PREFIX}/documents/${encodeURIComponent(documentId)}`, {
    method: "PUT",
    body: JSON.stringify({
      document,
      layerImages: colorLayerImages,
      layerMaterialImages,
    }),
  });
  return data.document;
}

export async function exportProject(documentId) {
  const data = await requestJson(`${API_PREFIX}/documents/${encodeURIComponent(documentId)}/project`, {
    method: "GET",
  });
  return data.project;
}

export async function importProject(project) {
  const data = await requestJson(`${API_PREFIX}/projects/import`, {
    method: "POST",
    body: JSON.stringify({ project }),
  });
  return data.document;
}
