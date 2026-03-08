import { BRUSH_PRESETS } from "./constants.js";
import { getPresetScopeForTool } from "./studio-helpers.js";

const STORAGE_KEY = "comfypencil.brush-presets.v1";
const BUILTIN_PRESET_ID_SET = new Set(BRUSH_PRESETS.map((preset) => preset.id));
const PRESET_META_KEYS = new Set(["id", "label", "libraryGroup", "tool", "presetId", "color"]);

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizePresetLabel(value, fallback = "Brush") {
  const label = String(value || "").trim();
  return label || fallback;
}

function slugifyLabel(value) {
  return normalizePresetLabel(value, "brush")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "brush";
}

export function createBrushPresetId(label = "brush") {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `brush_${slugifyLabel(label)}_${randomPart}`;
}

export function makeUniqueBrushPresetLabel(baseLabel, presets = []) {
  const fallbackLabel = normalizePresetLabel(baseLabel, "Brush");
  const usedLabels = new Set((presets || []).map((preset) => normalizePresetLabel(preset?.label).toLowerCase()));
  if (!usedLabels.has(fallbackLabel.toLowerCase())) {
    return fallbackLabel;
  }
  let index = 2;
  while (usedLabels.has(`${fallbackLabel} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${fallbackLabel} ${index}`;
}

function sanitizeBrushPreset(rawPreset) {
  if (!rawPreset || typeof rawPreset !== "object") {
    return null;
  }

  const presetScope = getPresetScopeForTool(rawPreset.tool);
  if (!presetScope) {
    return null;
  }

  const fallbackLabel = presetScope === "blend" ? "Blend" : "Brush";
  const preset = {
    id: String(rawPreset.id || createBrushPresetId(rawPreset.label || fallbackLabel)),
    label: normalizePresetLabel(rawPreset.label, fallbackLabel),
    libraryGroup: String(rawPreset.libraryGroup || "custom").trim().toLowerCase().replace(/\s+/g, "-") || "custom",
    tool: presetScope === "blend" ? "blend" : "brush",
  };

  Object.entries(rawPreset).forEach(([key, value]) => {
    if (PRESET_META_KEYS.has(key) || value == null || typeof value === "function" || typeof value === "object") {
      return;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      preset[key] = value;
    }
  });

  return preset;
}

function normalizeCustomBrushPresets(customPresets) {
  const presetMap = new Map();
  (customPresets || []).forEach((preset) => {
    const normalized = sanitizeBrushPreset(preset);
    if (!normalized || BUILTIN_PRESET_ID_SET.has(normalized.id)) {
      return;
    }
    presetMap.set(normalized.id, normalized);
  });
  return Array.from(presetMap.values());
}

export function loadCustomBrushPresets() {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return normalizeCustomBrushPresets(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function saveCustomBrushPresets(customPresets) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeCustomBrushPresets(customPresets)));
  } catch {
    // Ignore storage quota or privacy mode failures and keep the in-memory presets alive.
  }
}

export function buildBrushPresetFromBrush(brush, {
  id,
  label,
  libraryGroup,
  sourcePreset = null,
} = {}) {
  const presetScope = getPresetScopeForTool(brush?.tool || sourcePreset?.tool);
  if (!presetScope) {
    return null;
  }

  return sanitizeBrushPreset({
    ...sourcePreset,
    ...brush,
    id: id || sourcePreset?.id || createBrushPresetId(label || sourcePreset?.label || "brush"),
    label: normalizePresetLabel(label, sourcePreset?.label || (presetScope === "blend" ? "Blend" : "Brush")),
    libraryGroup: libraryGroup || sourcePreset?.libraryGroup || "custom",
    tool: presetScope === "blend" ? "blend" : "brush",
  });
}

export function isBuiltInBrushPresetId(presetId) {
  return BUILTIN_PRESET_ID_SET.has(presetId);
}
