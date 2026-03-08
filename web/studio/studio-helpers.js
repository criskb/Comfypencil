import { app } from "/scripts/app.js";

import { CANVAS_SYMMETRY_OPTIONS, STROKE_CONSTRAINT_OPTIONS } from "./constants.js";

export function getWidget(node, name) {
  return node?.widgets?.find((widget) => widget.name === name) || null;
}

export function setWidgetValue(node, name, value) {
  const widget = getWidget(node, name);
  if (!widget) {
    return;
  }
  widget.value = value;
  if (typeof widget.callback === "function") {
    widget.callback(value, app.graph, node, widget);
  }
  node.setDirtyCanvas?.(true, true);
}

export function getWidgetValue(node, name, fallback) {
  const widget = getWidget(node, name);
  return widget?.value ?? fallback;
}

export function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatRotation(value) {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric - Math.round(numeric)) < 0.05) {
    return `${Math.round(numeric)}deg`;
  }
  return `${numeric.toFixed(1)}deg`;
}

export function getSymmetryLabel(value) {
  return CANVAS_SYMMETRY_OPTIONS.find((option) => option.value === value)?.label || "Off";
}

export function getNextSymmetryMode(value) {
  const currentIndex = CANVAS_SYMMETRY_OPTIONS.findIndex((option) => option.value === value);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % CANVAS_SYMMETRY_OPTIONS.length : 0;
  return CANVAS_SYMMETRY_OPTIONS[nextIndex].value;
}

export function getStrokeConstraintLabel(value) {
  const numeric = Number(value) || 0;
  if (!numeric) {
    return "";
  }
  return `Snap ${numeric}deg`;
}

export function getNextStrokeConstraint(value) {
  const currentIndex = STROKE_CONSTRAINT_OPTIONS.findIndex((option) => Number(option.value) === Number(value || 0));
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % STROKE_CONSTRAINT_OPTIONS.length : 0;
  return Number(STROKE_CONSTRAINT_OPTIONS[nextIndex].value);
}

export function formatLibraryGroupLabel(group) {
  return String(group || "brushes")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isStrokeTool(tool) {
  return ["brush", "eraser", "blend"].includes(tool);
}

export function getPresetScopeForTool(tool) {
  if (tool === "blend") {
    return "blend";
  }
  if (tool === "brush" || tool === "eraser") {
    return "brush";
  }
  return "";
}

export function isTextEntryElement(element) {
  return Boolean(
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || element?.isContentEditable,
  );
}

export function downloadBlob(blob, filename) {
  if (!blob) {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function roundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, safeRadius);
    return;
  }
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}
