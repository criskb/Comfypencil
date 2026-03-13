const STORAGE_KEY = "comfypencil.color-palette.v1";
const PALETTE_FILE_VERSION = 1;

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeHexColor(color) {
  const raw = String(color || "").trim().replace(/^#/, "");
  if (!raw) {
    return "";
  }
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split("").map((character) => `${character}${character}`).join("").toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return "";
}

export function normalizePaletteColors(colors, limit = 24) {
  const unique = new Set();
  const normalized = [];
  (colors || []).forEach((color) => {
    const next = normalizeHexColor(color);
    if (!next || unique.has(next)) {
      return;
    }
    unique.add(next);
    normalized.push(next);
  });
  return normalized.slice(0, limit);
}

export function loadCustomPaletteColors() {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizePaletteColors(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveCustomPaletteColors(colors) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizePaletteColors(colors)));
  } catch {
    // Ignore privacy mode and quota failures.
  }
}

export function createColorPaletteBlob(colors) {
  const payload = {
    version: PALETTE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    colors: normalizePaletteColors(colors),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export function getColorPaletteFilename() {
  return "comfypencil-palette.colors.json";
}

export async function readColorPaletteFile(file) {
  const raw = await file.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Color palette file is not valid JSON.");
  }
  if (Number(parsed?.version || 0) !== PALETTE_FILE_VERSION) {
    throw new Error("Unsupported color palette version.");
  }
  const colors = normalizePaletteColors(parsed.colors);
  if (!colors.length) {
    throw new Error("Color palette file does not contain any colors.");
  }
  return colors;
}
