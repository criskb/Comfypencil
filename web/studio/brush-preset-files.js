import {
  createBrushPresetId,
  makeUniqueBrushPresetLabel,
  normalizeCustomBrushPresets,
} from "./brush-presets-store.js";

const BRUSH_LIBRARY_FILE_VERSION = 1;

function normalizeScopeLabel(value) {
  return String(value || "brushes")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "brushes";
}

export function createBrushPresetLibraryBlob(presets, { scopeLabel = "brushes" } = {}) {
  const payload = {
    version: BRUSH_LIBRARY_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    scope: normalizeScopeLabel(scopeLabel),
    presets: normalizeCustomBrushPresets(Array.isArray(presets) ? presets : []),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export function getBrushPresetLibraryFilename(scopeLabel = "brushes") {
  return `comfypencil-${normalizeScopeLabel(scopeLabel)}.brushes.json`;
}

export async function readBrushPresetLibraryFile(file) {
  const raw = await file.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Preset file is not valid JSON.");
  }

  if (Number(parsed?.version || 0) !== BRUSH_LIBRARY_FILE_VERSION) {
    throw new Error("Unsupported preset library version.");
  }

  const presets = normalizeCustomBrushPresets(Array.isArray(parsed?.presets) ? parsed.presets : []);
  if (!presets.length) {
    throw new Error("Preset file does not contain any supported presets.");
  }

  return {
    version: BRUSH_LIBRARY_FILE_VERSION,
    scope: normalizeScopeLabel(parsed.scope),
    presets,
  };
}

export function mergeImportedBrushPresets(importedPresets, existingPresets = []) {
  const existing = Array.isArray(existingPresets) ? existingPresets : [];
  const usedIds = new Set(existing.map((preset) => String(preset?.id || "").trim()).filter(Boolean));
  const merged = [...existing];
  const imported = [];

  normalizeCustomBrushPresets(importedPresets).forEach((preset) => {
    const nextLabel = makeUniqueBrushPresetLabel(preset.label, merged);
    let nextId = String(preset.id || "").trim();
    if (!nextId || usedIds.has(nextId)) {
      nextId = createBrushPresetId(nextLabel);
    }
    usedIds.add(nextId);
    const mergedPreset = {
      ...preset,
      id: nextId,
      label: nextLabel,
      libraryGroup: preset.libraryGroup || "imported",
    };
    merged.push(mergedPreset);
    imported.push(mergedPreset);
  });

  return {
    presets: merged,
    imported,
  };
}
