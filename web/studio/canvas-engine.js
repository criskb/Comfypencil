import { BLEND_MODES, BRUSH_PRESETS, CANVAS_SYMMETRY_OPTIONS, STROKE_CONSTRAINT_OPTIONS } from "./constants.js";
import { packBrushMaterial, stampBrushDab } from "./brush-stamp.js";
import { clamp, lerp, rgbToHex } from "./brush-utils.js";

const SYMMETRY_MODE_SET = new Set(CANVAS_SYMMETRY_OPTIONS.map((option) => option.value));
const STROKE_CONSTRAINT_SET = new Set(STROKE_CONSTRAINT_OPTIONS.map((option) => Number(option.value)));

function nowIso() {
  return new Date().toISOString();
}

function resolvePointerPressure(event, fallback = 1) {
  if (event?.pointerType && event.pointerType !== "pen") {
    return 1;
  }
  const value = event?.pressure;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolvePointerTilt(event, fallback = { magnitude: 0, angle: 0, x: 0, y: 0 }) {
  if (!event || (event.pointerType && event.pointerType !== "pen")) {
    return fallback;
  }
  const tiltX = Number.isFinite(event.tiltX) ? event.tiltX : 0;
  const tiltY = Number.isFinite(event.tiltY) ? event.tiltY : 0;
  const magnitude = clamp(Math.hypot(tiltX, tiltY) / 90, 0, 1);
  const angle = magnitude > 0.0001 ? Math.atan2(tiltY, tiltX) : (fallback?.angle ?? 0);
  return {
    x: tiltX,
    y: tiltY,
    magnitude,
    angle,
  };
}

function lerpAngle(fromAngle, toAngle, amount) {
  const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
  return fromAngle + (delta * clamp(amount, 0, 1));
}

function normalizeRotationDegrees(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  let normalized = ((numeric + 180) % 360 + 360) % 360 - 180;
  if (Object.is(normalized, -0)) {
    normalized = 0;
  }
  return clamp(normalized, -180, 180);
}

function normalizeStrokeConstraint(value) {
  const numeric = Math.round(Number(value) || 0);
  return STROKE_CONSTRAINT_SET.has(numeric) ? numeric : 0;
}

function normalizeAssist(assist) {
  const rotation = normalizeRotationDegrees(assist?.rotation ?? 0);
  const symmetry = SYMMETRY_MODE_SET.has(assist?.symmetry) ? assist.symmetry : "off";
  const strokeConstraint = normalizeStrokeConstraint(assist?.strokeConstraint ?? 0);
  return {
    rotation,
    symmetry,
    strokeConstraint,
  };
}

function getPresetScopeForTool(tool) {
  if (tool === "blend") {
    return "blend";
  }
  if (tool === "brush" || tool === "eraser") {
    return "brush";
  }
  return "";
}

function cloneBrushPresetList(presets) {
  const source = Array.isArray(presets) && presets.length ? presets : BRUSH_PRESETS;
  return source.map((preset) => ({ ...preset }));
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

function waitForImageData(dataUrl) {
  return loadImage(dataUrl);
}

function copyLayerMeta(layer) {
  const {
    canvas,
    ctx,
    materialCanvas,
    materialCtx,
    dataUrl,
    imageUrl,
    materialDataUrl,
    materialImageUrl,
    ...meta
  } = layer;
  return { ...meta };
}

function serializeLayerBitmaps(layer) {
  return {
    color: layer.canvas.toDataURL("image/png"),
    material: layer.materialCanvas.toDataURL("image/png"),
  };
}

function normalizeLayerBitmaps(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      color: typeof payload.color === "string" ? payload.color : (typeof payload.image === "string" ? payload.image : ""),
      material: typeof payload.material === "string" ? payload.material : "",
    };
  }
  return {
    color: typeof payload === "string" ? payload : "",
    material: "",
  };
}

function packedMaterialBytes(brush, alpha = 1) {
  const packed = packBrushMaterial(brush, alpha);
  return [packed.r, packed.g, packed.b, packed.a];
}

function blankLayer(width, height, layerId, name) {
  const canvas = createCanvas(width, height);
  const materialCanvas = createCanvas(width, height);
  return {
    id: layerId,
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    locked: false,
    alphaLocked: false,
    thumbnailVersion: 0,
    updatedAt: nowIso(),
    imageUrl: "",
    materialImageUrl: "",
    canvas,
    ctx: canvas.getContext("2d", { willReadFrequently: true }),
    materialCanvas,
    materialCtx: materialCanvas.getContext("2d", { willReadFrequently: true }),
  };
}

function mapCanvasBlendMode(mode) {
  return BLEND_MODES.find((item) => item.value === mode)?.canvas || "source-over";
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function resizeImageFit(image, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  return canvas;
}

export class CanvasEngine {
  constructor(displayCanvas, { onChange } = {}) {
    this.displayCanvas = displayCanvas;
    this.displayCtx = displayCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    this.compositeCanvas = document.createElement("canvas");
    this.compositeCtx = this.compositeCanvas.getContext("2d", { willReadFrequently: true });
    this.onChange = onChange;
    this.document = null;
    this.historyUndo = [];
    this.historyRedo = [];
    this.pendingStroke = null;
    this.panningState = null;
    this.brushPresets = cloneBrushPresetList(BRUSH_PRESETS);
    this.view = {
      zoom: 1,
      panX: 0,
      panY: 0,
      originX: 0,
      originY: 0,
    };
    const initialPreset = this.brushPresets[0] || BRUSH_PRESETS[0] || {};
    this.brush = {
      color: "#111111",
      tool: "brush",
      presetId: initialPreset.id,
      ...initialPreset,
    };
    this.dirtyLayerIds = new Set();
    this.soloLayerId = "";
  }

  async loadDocument(document) {
    const hydratedLayers = [];
    for (const layer of document.layers || []) {
      hydratedLayers.push(await this.#hydrateLayer(document, layer));
    }
    this.document = {
      ...document,
      assist: normalizeAssist(document.assist),
      layers: hydratedLayers.length
        ? hydratedLayers
        : [blankLayer(document.width, document.height, "layer_1", "Layer 1")],
    };
    if (!this.document.activeLayerId || !this.document.layers.some((layer) => layer.id === this.document.activeLayerId)) {
      this.document.activeLayerId = this.document.layers[this.document.layers.length - 1].id;
    }
    this.compositeCanvas.width = this.document.width;
    this.compositeCanvas.height = this.document.height;
    this.historyUndo = [];
    this.historyRedo = [];
    this.dirtyLayerIds.clear();
    this.soloLayerId = "";
    this.fitToView();
    this.render();
  }

  setBrushColor(hex) {
    this.brush.color = hex;
    this.#emitChange("brush");
  }

  setBrushPresets(presets) {
    this.brushPresets = cloneBrushPresetList(presets);
  }

  setBrushPreset(presetId) {
    const preset = this.brushPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    const activeScope = getPresetScopeForTool(this.brush.tool);
    const presetScope = getPresetScopeForTool(preset.tool);
    this.brush = {
      ...this.brush,
      ...preset,
      presetId,
      tool: activeScope && presetScope === activeScope ? this.brush.tool : preset.tool,
    };
    this.#emitChange("brush");
  }

  patchBrush(patch) {
    this.brush = {
      ...this.brush,
      ...patch,
    };
    this.#emitChange("brush");
  }

  getActiveLayer() {
    if (!this.document) {
      return null;
    }
    return this.document.layers.find((layer) => layer.id === this.document.activeLayerId) || this.document.layers[this.document.layers.length - 1] || null;
  }

  getActiveLayerIndex() {
    if (!this.document) {
      return -1;
    }
    return this.document.layers.findIndex((layer) => layer.id === this.document.activeLayerId);
  }

  hasSoloLayer() {
    return Boolean(this.soloLayerId && this.document?.layers.some((layer) => layer.id === this.soloLayerId));
  }

  isLayerSolo(layerId) {
    return this.hasSoloLayer() && this.soloLayerId === layerId;
  }

  setActiveLayer(layerId) {
    if (!this.document || !this.document.layers.some((layer) => layer.id === layerId)) {
      return;
    }
    this.document.activeLayerId = layerId;
    this.render();
    this.#emitChange("layers");
  }

  fitToView() {
    if (!this.document) {
      return;
    }
    const rect = this.displayCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const horizontalPadding = 42;
    const verticalPadding = 54;
    const paddedWidth = Math.max(rect.width - horizontalPadding, 80);
    const paddedHeight = Math.max(rect.height - verticalPadding, 80);
    const rotation = this.getRotationRadians();
    const rotatedWidth = (this.document.width * Math.abs(Math.cos(rotation))) + (this.document.height * Math.abs(Math.sin(rotation)));
    const rotatedHeight = (this.document.width * Math.abs(Math.sin(rotation))) + (this.document.height * Math.abs(Math.cos(rotation)));
    this.view.zoom = clamp(Math.min(paddedWidth / rotatedWidth, paddedHeight / rotatedHeight), 0.08, 8);
    this.view.panX = 0;
    this.view.panY = 0;
    this.render();
    this.#emitChange("viewport");
  }

  zoomAt(clientX, clientY, factor) {
    if (!this.document) {
      return;
    }
    const before = this.screenToDoc(clientX, clientY);
    const nextZoom = clamp(this.view.zoom * factor, 0.08, 20);
    this.view.zoom = nextZoom;
    this.render();
    const after = this.screenToDoc(clientX, clientY);
    this.view.panX += (after.x - before.x) * nextZoom;
    this.view.panY += (after.y - before.y) * nextZoom;
    this.render();
    this.#emitChange("viewport");
  }

  panBy(dx, dy) {
    this.view.panX += dx;
    this.view.panY += dy;
    this.render();
    this.#emitChange("viewport");
  }

  setZoom(zoom, { resetPan = false } = {}) {
    if (!this.document) {
      return;
    }
    this.view.zoom = clamp(zoom, 0.08, 20);
    if (resetPan) {
      this.view.panX = 0;
      this.view.panY = 0;
    }
    this.render();
    this.#emitChange("viewport");
  }

  getRotationDegrees() {
    return normalizeRotationDegrees(this.document?.assist?.rotation ?? 0);
  }

  getRotationRadians() {
    return (this.getRotationDegrees() * Math.PI) / 180;
  }

  getSymmetryMode() {
    return this.document?.assist?.symmetry || "off";
  }

  getStrokeConstraintDegrees() {
    return normalizeStrokeConstraint(this.document?.assist?.strokeConstraint ?? 0);
  }

  setCanvasRotation(rotationDegrees) {
    if (!this.document) {
      return;
    }
    this.updateDocumentMeta({
      assist: {
        rotation: normalizeRotationDegrees(rotationDegrees),
      },
    });
  }

  rotateCanvasBy(deltaDegrees) {
    this.setCanvasRotation(this.getRotationDegrees() + deltaDegrees);
  }

  setStrokeConstraintDegrees(value) {
    if (!this.document) {
      return;
    }
    this.updateDocumentMeta({
      assist: {
        strokeConstraint: normalizeStrokeConstraint(value),
      },
    });
  }

  getCanvasPlacement(rect = this.displayCanvas.getBoundingClientRect()) {
    if (!this.document) {
      return null;
    }
    const width = this.document.width * this.view.zoom;
    const height = this.document.height * this.view.zoom;
    const x = rect.width / 2 - width / 2 + this.view.panX;
    const y = rect.height / 2 - height / 2 + this.view.panY;
    return {
      x,
      y,
      width,
      height,
      centerX: x + (width / 2),
      centerY: y + (height / 2),
      right: x + width,
      bottom: y + height,
    };
  }

  getVisibleDocumentRect(rect = this.displayCanvas.getBoundingClientRect()) {
    if (!this.document) {
      return null;
    }
    const corners = [
      this.screenToDoc(rect.left, rect.top),
      this.screenToDoc(rect.right, rect.top),
      this.screenToDoc(rect.left, rect.bottom),
      this.screenToDoc(rect.right, rect.bottom),
    ];
    const left = clamp(Math.min(...corners.map((point) => point.x)), 0, this.document.width);
    const top = clamp(Math.min(...corners.map((point) => point.y)), 0, this.document.height);
    const right = clamp(Math.max(...corners.map((point) => point.x)), 0, this.document.width);
    const bottom = clamp(Math.max(...corners.map((point) => point.y)), 0, this.document.height);
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  getCompositePreviewCanvas() {
    return this.compositeCanvas;
  }

  getPendingStrokeGuide() {
    if (!this.pendingStroke?.constraintDegrees) {
      return null;
    }
    const startPoint = this.pendingStroke.startPoint;
    const endPoint = this.pendingStroke.lastPoint || startPoint;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    return {
      startPoint,
      endPoint,
      angle: Math.atan2(dy, dx),
      length: Math.hypot(dx, dy),
      constraintDegrees: this.pendingStroke.constraintDegrees,
    };
  }

  screenToDoc(clientX, clientY) {
    const rect = this.displayCanvas.getBoundingClientRect();
    const placement = this.getCanvasPlacement(rect);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!placement) {
      return { x: 0, y: 0 };
    }
    const offsetX = x - placement.centerX;
    const offsetY = y - placement.centerY;
    const inverseRotation = -this.getRotationRadians();
    const rotatedX = (offsetX * Math.cos(inverseRotation)) - (offsetY * Math.sin(inverseRotation));
    const rotatedY = (offsetX * Math.sin(inverseRotation)) + (offsetY * Math.cos(inverseRotation));
    return {
      x: (rotatedX / this.view.zoom) + (this.document.width / 2),
      y: (rotatedY / this.view.zoom) + (this.document.height / 2),
    };
  }

  docToScreen(docX, docY, rect = this.displayCanvas.getBoundingClientRect()) {
    const placement = this.getCanvasPlacement(rect);
    if (!placement || !this.document) {
      return { x: 0, y: 0, localX: 0, localY: 0 };
    }
    const rotation = this.getRotationRadians();
    const offsetX = (docX - (this.document.width / 2)) * this.view.zoom;
    const offsetY = (docY - (this.document.height / 2)) * this.view.zoom;
    const rotatedX = (offsetX * Math.cos(rotation)) - (offsetY * Math.sin(rotation));
    const rotatedY = (offsetX * Math.sin(rotation)) + (offsetY * Math.cos(rotation));
    const localX = placement.centerX + rotatedX;
    const localY = placement.centerY + rotatedY;
    return {
      x: rect.left + localX,
      y: rect.top + localY,
      localX,
      localY,
    };
  }

  render() {
    if (!this.document) {
      return;
    }
    const rect = this.displayCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.displayCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.displayCanvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = this.displayCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#17181b";
    ctx.fillRect(0, 0, rect.width, rect.height);
    this.#drawWorkspaceBackdrop(ctx, rect.width, rect.height);
    this.#renderCompositeSurface();

    const placement = this.getCanvasPlacement(rect);
    if (!placement) {
      return;
    }
    this.view.originX = placement.x;
    this.view.originY = placement.y;

    const localPlacement = {
      x: -placement.width / 2,
      y: -placement.height / 2,
      width: placement.width,
      height: placement.height,
      centerX: 0,
      centerY: 0,
      right: placement.width / 2,
      bottom: placement.height / 2,
    };
    ctx.save();
    ctx.translate(placement.centerX, placement.centerY);
    ctx.rotate(this.getRotationRadians());
    this.#drawDocumentSurface(ctx, localPlacement);
    this.#drawCheckerboard(ctx, localPlacement.x, localPlacement.y, localPlacement.width, localPlacement.height, 20, 22);
    ctx.save();
    this.#pathRoundedRect(ctx, localPlacement.x, localPlacement.y, localPlacement.width, localPlacement.height, 22);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.compositeCanvas, localPlacement.x, localPlacement.y, localPlacement.width, localPlacement.height);
    ctx.restore();
    ctx.restore();
  }

  beginInteraction(event, { temporaryPan = false } = {}) {
    if (!this.document) {
      return false;
    }
    const point = this.screenToDoc(event.clientX, event.clientY);
    const tool = temporaryPan ? "pan" : this.brush.tool;

    if (tool === "pan") {
      this.panningState = {
        startX: event.clientX,
        startY: event.clientY,
        panX: this.view.panX,
        panY: this.view.panY,
      };
      return true;
    }

    if (tool === "eyedropper") {
      this.pickColor(point.x, point.y);
      return true;
    }

    if (tool === "fill") {
      this.fillAt(point.x, point.y);
      return true;
    }

    const activeLayer = this.getActiveLayer();
    if (!activeLayer || activeLayer.locked || (activeLayer.alphaLocked && tool === "eraser")) {
      return false;
    }

    const constraintDegrees = this.#resolveStrokeConstraint(event, tool);
    this.pendingStroke = {
      tool,
      layerId: activeLayer.id,
      before: serializeLayerBitmaps(activeLayer),
      startPoint: point,
      lastPoint: point,
      smoothedPoint: point,
      distance: 0,
      pressure: resolvePointerPressure(event, 1),
      tilt: resolvePointerTilt(event),
      alphaMask: activeLayer.alphaLocked ? this.#captureAlphaMask(activeLayer) : null,
      lastTimestamp: event.timeStamp || performance.now(),
      smoothedVelocity: 0,
      lastAngle: 0,
      lastRenderedPoint: point,
      renderedStampCount: 0,
      constraintDegrees,
      assistStates: this.#createAssistStates(point, tool),
    };
    return true;
  }

  moveInteraction(event, { temporaryPan = false } = {}) {
    if (this.panningState) {
      this.view.panX = this.panningState.panX + (event.clientX - this.panningState.startX);
      this.view.panY = this.panningState.panY + (event.clientY - this.panningState.startY);
      this.render();
      return true;
    }

    if (!this.pendingStroke) {
      return false;
    }

    const activeLayer = this.document.layers.find((layer) => layer.id === this.pendingStroke.layerId);
    if (!activeLayer) {
      return false;
    }

    const point = this.screenToDoc(event.clientX, event.clientY);
    const constrainedPoint = this.pendingStroke.constraintDegrees
      ? this.#applyStrokeConstraint(point, this.pendingStroke.constraintDegrees)
      : point;
    const smoothing = clamp(this.brush.smoothing ?? 0.4, 0, 0.95);
    const stabilization = clamp(this.brush.stabilization ?? 0, 0, 1);
    const motionFilter = clamp(this.brush.motionFilter ?? 0, 0, 1);
    const motionFilterExpression = clamp(this.brush.motionFilterExpression ?? 0.5, 0, 1);
    const timestamp = event.timeStamp || performance.now();
    const deltaMs = Math.max(1, timestamp - (this.pendingStroke.lastTimestamp || timestamp));
    const rawDistance = Math.hypot(
      constrainedPoint.x - this.pendingStroke.smoothedPoint.x,
      constrainedPoint.y - this.pendingStroke.smoothedPoint.y,
    );
    const instantVelocity = this.pendingStroke.constraintDegrees ? 0 : (rawDistance / deltaMs);
    const velocityNormalized = clamp(instantVelocity / 1.25, 0, 1);
    const baseLag = clamp((smoothing * 0.78) + (stabilization * 0.18), 0, 0.965);
    const motionLag = motionFilter
      ? motionFilter * Math.pow(velocityNormalized, 1.15 + motionFilterExpression * 1.45) * 0.28
      : 0;
    const followAmount = 1 - clamp(baseLag + motionLag, 0, 0.985);
    const smoothedPoint = this.pendingStroke.constraintDegrees
      ? constrainedPoint
      : {
        x: this.pendingStroke.smoothedPoint.x + (constrainedPoint.x - this.pendingStroke.smoothedPoint.x) * followAmount,
        y: this.pendingStroke.smoothedPoint.y + (constrainedPoint.y - this.pendingStroke.smoothedPoint.y) * followAmount,
      };
    const distance = Math.hypot(smoothedPoint.x - this.pendingStroke.lastPoint.x, smoothedPoint.y - this.pendingStroke.lastPoint.y);
    const nextPressure = resolvePointerPressure(event, this.pendingStroke.pressure || 1);
    const nextTilt = resolvePointerTilt(event, this.pendingStroke.tilt);
    this.pendingStroke.smoothedVelocity = this.pendingStroke.constraintDegrees
      ? 0
      : lerp(this.pendingStroke.smoothedVelocity || 0, instantVelocity, 0.24);
    if (distance < 0.01) {
      this.pendingStroke.pressure = nextPressure;
      this.pendingStroke.tilt = nextTilt;
      this.pendingStroke.lastTimestamp = timestamp;
      this.pendingStroke.lastPoint = smoothedPoint;
      this.pendingStroke.smoothedPoint = smoothedPoint;
      return true;
    }
    const spacing = Math.max(1, this.brush.size * (this.brush.spacing ?? 0.1));
    const steps = Math.max(1, Math.ceil(distance / spacing));
    const stepDistance = distance / steps;
    const initialStrokeStamp = this.pendingStroke.renderedStampCount === 0;

    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const stampPoint = {
        x: this.pendingStroke.lastPoint.x + (smoothedPoint.x - this.pendingStroke.lastPoint.x) * t,
        y: this.pendingStroke.lastPoint.y + (smoothedPoint.y - this.pendingStroke.lastPoint.y) * t,
      };
      const stampPressure = lerp(this.pendingStroke.pressure || 1, nextPressure, t);
      const stampTilt = {
        x: lerp(this.pendingStroke.tilt?.x ?? 0, nextTilt.x ?? 0, t),
        y: lerp(this.pendingStroke.tilt?.y ?? 0, nextTilt.y ?? 0, t),
        magnitude: lerp(this.pendingStroke.tilt?.magnitude ?? 0, nextTilt.magnitude ?? 0, t),
        angle: lerpAngle(this.pendingStroke.tilt?.angle ?? 0, nextTilt.angle ?? 0, t),
      };
      this.pendingStroke.distance += stepDistance;
      this.#stampPoint(activeLayer, stampPoint, stampPressure, initialStrokeStamp && index === 1, stampTilt);
    }

    if (this.pendingStroke.alphaMask) {
      this.#restoreAlphaMask(activeLayer, this.pendingStroke.alphaMask);
      this.#restoreMaterialAlphaMask(activeLayer, this.pendingStroke.alphaMask);
    }
    this.pendingStroke.pressure = nextPressure;
    this.pendingStroke.tilt = nextTilt;
    this.pendingStroke.lastTimestamp = timestamp;
    this.pendingStroke.lastPoint = smoothedPoint;
    this.pendingStroke.smoothedPoint = smoothedPoint;
    this.render();
    return true;
  }

  endInteraction() {
    if (this.panningState) {
      this.panningState = null;
      return true;
    }

    if (!this.pendingStroke || !this.document) {
      return false;
    }

    const layer = this.document.layers.find((item) => item.id === this.pendingStroke.layerId);
    if (layer) {
      if ((this.pendingStroke.renderedStampCount || 0) === 0) {
        this.#stampPoint(layer, this.pendingStroke.startPoint, this.pendingStroke.pressure, true, this.pendingStroke.tilt);
        if (this.pendingStroke.alphaMask) {
          this.#restoreAlphaMask(layer, this.pendingStroke.alphaMask);
          this.#restoreMaterialAlphaMask(layer, this.pendingStroke.alphaMask);
        }
      }
      this.#pushAction({
        type: "layer",
        label: "Stroke",
        layerId: layer.id,
        before: this.pendingStroke.before,
        after: serializeLayerBitmaps(layer),
      });
      this.#markLayerDirty(layer);
    }
    this.pendingStroke = null;
    this.render();
    this.#emitChange("document");
    return true;
  }

  async undo() {
    const action = this.historyUndo.pop();
    if (!action) {
      return false;
    }
    await this.#applyAction(action, "undo");
    this.historyRedo.push(action);
    this.render();
    this.#emitChange("history");
    return true;
  }

  async redo() {
    const action = this.historyRedo.pop();
    if (!action) {
      return false;
    }
    await this.#applyAction(action, "redo");
    this.historyUndo.push(action);
    this.render();
    this.#emitChange("history");
    return true;
  }

  async addLayer(name = "") {
    const before = this.captureSnapshot();
    const index = this.document.layers.length + 1;
    const layer = blankLayer(this.document.width, this.document.height, randomId("layer"), name || `Layer ${index}`);
    this.document.layers.push(layer);
    this.document.activeLayerId = layer.id;
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Add Layer", before, after });
    this.#markLayerDirty(layer);
    this.render();
    this.#emitChange("layers");
  }

  async duplicateActiveLayer() {
    const activeLayer = this.getActiveLayer();
    if (!activeLayer) {
      return;
    }
    const before = this.captureSnapshot();
    const clone = blankLayer(this.document.width, this.document.height, randomId("layer"), `${activeLayer.name} Copy`);
    clone.ctx.drawImage(activeLayer.canvas, 0, 0);
    clone.materialCtx.drawImage(activeLayer.materialCanvas, 0, 0);
    clone.visible = activeLayer.visible;
    clone.opacity = activeLayer.opacity;
    clone.blendMode = activeLayer.blendMode;
    clone.locked = activeLayer.locked;
    clone.alphaLocked = activeLayer.alphaLocked;
    this.document.layers.push(clone);
    this.document.activeLayerId = clone.id;
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Duplicate Layer", before, after });
    this.#markLayerDirty(clone);
    this.render();
    this.#emitChange("layers");
  }

  async deleteActiveLayer() {
    if (!this.document || this.document.layers.length <= 1) {
      return;
    }
    const activeLayer = this.getActiveLayer();
    if (!activeLayer) {
      return;
    }
    const before = this.captureSnapshot();
    this.document.layers = this.document.layers.filter((layer) => layer.id !== activeLayer.id);
    this.document.activeLayerId = this.document.layers[this.document.layers.length - 1]?.id || "";
    if (this.soloLayerId === activeLayer.id) {
      this.soloLayerId = "";
    }
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Delete Layer", before, after });
    this.dirtyLayerIds.add(activeLayer.id);
    this.render();
    this.#emitChange("layers");
  }

  async moveActiveLayer(direction) {
    const activeLayer = this.getActiveLayer();
    if (!activeLayer) {
      return;
    }
    const currentIndex = this.document.layers.findIndex((layer) => layer.id === activeLayer.id);
    const nextIndex = clamp(currentIndex + direction, 0, this.document.layers.length - 1);
    if (currentIndex === nextIndex) {
      return;
    }
    const before = this.captureSnapshot();
    const [layer] = this.document.layers.splice(currentIndex, 1);
    this.document.layers.splice(nextIndex, 0, layer);
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Move Layer", before, after });
    this.render();
    this.#emitChange("layers");
  }

  async mergeActiveLayerDown() {
    if (!this.document || this.document.layers.length <= 1) {
      return;
    }
    const activeIndex = this.getActiveLayerIndex();
    if (activeIndex <= 0) {
      return;
    }
    const activeLayer = this.document.layers[activeIndex];
    const targetLayer = this.document.layers[activeIndex - 1];
    if (!activeLayer || !targetLayer || activeLayer.locked || targetLayer.locked) {
      return;
    }

    const before = this.captureSnapshot();
    const merged = createCanvas(this.document.width, this.document.height);
    const mergedCtx = merged.getContext("2d", { willReadFrequently: true });
    const mergedMaterial = createCanvas(this.document.width, this.document.height);
    const mergedMaterialCtx = mergedMaterial.getContext("2d", { willReadFrequently: true });
    mergedCtx.drawImage(targetLayer.canvas, 0, 0);
    mergedMaterialCtx.drawImage(targetLayer.materialCanvas, 0, 0);
    if (activeLayer.visible !== false) {
      mergedCtx.save();
      mergedCtx.globalAlpha = activeLayer.opacity ?? 1;
      mergedCtx.globalCompositeOperation = mapCanvasBlendMode(activeLayer.blendMode);
      mergedCtx.drawImage(activeLayer.canvas, 0, 0);
      mergedCtx.restore();

      mergedMaterialCtx.save();
      mergedMaterialCtx.globalAlpha = activeLayer.opacity ?? 1;
      mergedMaterialCtx.globalCompositeOperation = "source-over";
      mergedMaterialCtx.drawImage(activeLayer.materialCanvas, 0, 0);
      mergedMaterialCtx.restore();
    }

    targetLayer.ctx.clearRect(0, 0, targetLayer.canvas.width, targetLayer.canvas.height);
    targetLayer.ctx.drawImage(merged, 0, 0);
    targetLayer.materialCtx.clearRect(0, 0, targetLayer.materialCanvas.width, targetLayer.materialCanvas.height);
    targetLayer.materialCtx.drawImage(mergedMaterial, 0, 0);
    this.document.layers.splice(activeIndex, 1);
    this.document.activeLayerId = targetLayer.id;
    if (this.soloLayerId === activeLayer.id || this.soloLayerId === targetLayer.id) {
      this.soloLayerId = targetLayer.id;
    }

    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Merge Down", before, after });
    this.#markLayerDirty(targetLayer);
    this.dirtyLayerIds.add(activeLayer.id);
    this.render();
    this.#emitChange("layers");
  }

  async clearActiveLayer() {
    const activeLayer = this.getActiveLayer();
    if (!activeLayer || activeLayer.locked) {
      return;
    }
    const before = serializeLayerBitmaps(activeLayer);
    activeLayer.ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    activeLayer.materialCtx.clearRect(0, 0, activeLayer.materialCanvas.width, activeLayer.materialCanvas.height);
    const after = serializeLayerBitmaps(activeLayer);
    this.#pushAction({ type: "layer", label: "Clear Layer", layerId: activeLayer.id, before, after });
    this.#markLayerDirty(activeLayer);
    this.render();
    this.#emitChange("document");
  }

  toggleSoloLayer(layerId) {
    if (!this.document || !this.document.layers.some((layer) => layer.id === layerId)) {
      return;
    }
    this.soloLayerId = this.soloLayerId === layerId ? "" : layerId;
    this.render();
    this.#emitChange("layer-preview");
  }

  async importFile(file) {
    const image = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      loadImage(url)
        .then((result) => {
          URL.revokeObjectURL(url);
          resolve(result);
        })
        .catch((error) => {
          URL.revokeObjectURL(url);
          reject(error);
        });
    });

    return this.importImage(image, {
      name: file.name.replace(/\.[^.]+$/, "") || "Imported Layer",
      actionLabel: "Import Layer",
    });
  }

  async importBlob(blob, { name = "Imported Layer", actionLabel = "Import Layer" } = {}) {
    const image = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      loadImage(url)
        .then((result) => {
          URL.revokeObjectURL(url);
          resolve(result);
        })
        .catch((error) => {
          URL.revokeObjectURL(url);
          reject(error);
        });
    });
    return this.importImage(image, { name, actionLabel });
  }

  importImage(image, { name = "Imported Layer", actionLabel = "Import Layer" } = {}) {
    const before = this.captureSnapshot();
    const layer = blankLayer(this.document.width, this.document.height, randomId("layer"), name);
    const fitted = resizeImageFit(image, this.document.width, this.document.height);
    layer.ctx.drawImage(fitted, 0, 0);
    this.document.layers.push(layer);
    this.document.activeLayerId = layer.id;
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: actionLabel, before, after });
    this.#markLayerDirty(layer);
    this.render();
    this.#emitChange("layers");
    return layer.id;
  }

  async exportBlob({ flattenBackground = false } = {}) {
    const canvas = createCanvas(this.document.width, this.document.height);
    const ctx = canvas.getContext("2d");
    if (flattenBackground && this.document.background?.mode === "solid") {
      ctx.fillStyle = this.document.background.color || "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.document.layers.forEach((layer) => {
      if (layer.visible === false) {
        return;
      }
      this.#drawLayerIntoContext(ctx, layer);
    });
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  captureSnapshot() {
    return {
      document: this.serializeDocument(),
      layers: Object.fromEntries(
        this.document.layers.map((layer) => [layer.id, serializeLayerBitmaps(layer)]),
      ),
    };
  }

  serializeDocument() {
    return {
      id: this.document.id || "",
      revision: Number(this.document.revision || 0),
      version: Number(this.document.version || 1),
      name: this.document.name || "Untitled Sketch",
      width: this.document.width,
      height: this.document.height,
      createdAt: this.document.createdAt || null,
      updatedAt: this.document.updatedAt || null,
      activeLayerId: this.document.activeLayerId,
      background: {
        mode: this.document.background?.mode || "transparent",
        color: this.document.background?.color || "#ffffff",
      },
      assist: normalizeAssist(this.document.assist),
      layers: this.document.layers.map(copyLayerMeta),
    };
  }

  takeDirtyLayerPayloads() {
    const payload = {};
    for (const layerId of this.dirtyLayerIds) {
      const layer = this.document.layers.find((item) => item.id === layerId);
      if (layer) {
        payload[layerId] = serializeLayerBitmaps(layer);
      }
    }
    return payload;
  }

  markSaved(savedDocument) {
    this.document.id = savedDocument.id;
    this.document.revision = savedDocument.revision;
    this.document.updatedAt = savedDocument.updatedAt;
    this.document.createdAt = savedDocument.createdAt;
    this.document.name = savedDocument.name;
    this.document.background = { ...savedDocument.background };
    this.document.assist = normalizeAssist(savedDocument.assist);
    this.document.activeLayerId = savedDocument.activeLayerId;
    this.document.layers = this.document.layers
      .filter((layer) => savedDocument.layers.some((saved) => saved.id === layer.id))
      .map((layer) => {
        const savedLayer = savedDocument.layers.find((item) => item.id === layer.id);
        return {
          ...layer,
          ...savedLayer,
        };
      });
    this.dirtyLayerIds.clear();
    this.#syncLayerPreviewState();
    this.#emitChange("document");
  }

  updateDocumentMeta(patch) {
    this.document = {
      ...this.document,
      ...patch,
      background: {
        ...this.document.background,
        ...(patch.background || {}),
      },
      assist: normalizeAssist({
        ...this.document.assist,
        ...(patch.assist || {}),
      }),
    };
    this.render();
    this.#emitChange("document");
  }

  updateLayerProperty(layerId, key, value) {
    const before = this.captureSnapshot();
    const layer = this.document.layers.find((item) => item.id === layerId);
    if (!layer) {
      return;
    }
    layer[key] = value;
    if (key === "visible" && !value && this.soloLayerId === layerId) {
      this.soloLayerId = "";
    }
    const after = this.captureSnapshot();
    this.#pushAction({ type: "snapshot", label: "Layer Property", before, after });
    this.#touchLayer(layer);
    this.render();
    this.#emitChange("layers");
  }

  sampleCompositeHex(x, y) {
    const sampled = this.#sampleCompositeColor(x, y, 2);
    return rgbToHex(sampled);
  }

  pickColor(x, y) {
    const radius = Math.max(2, Math.round(this.brush.size * 0.18));
    const hex = rgbToHex(this.#sampleCompositeColor(x, y, radius));
    this.brush.color = hex;
    this.#emitChange("brush");
  }

  fillAt(x, y) {
    const activeLayer = this.getActiveLayer();
    if (!activeLayer || activeLayer.locked) {
      return;
    }
    const before = serializeLayerBitmaps(activeLayer);
    const alphaMask = activeLayer.alphaLocked ? this.#captureAlphaMask(activeLayer) : null;
    const sampleAllLayers = this.brush.sampleAllLayers !== false;
    const tolerance = clamp(Number(this.brush.fillTolerance ?? 18), 0, 128);
    let sourceData;
    if (sampleAllLayers) {
      this.#renderCompositeSurface();
      sourceData = this.compositeCtx.getImageData(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
    }
    const imageData = activeLayer.ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    const materialData = activeLayer.materialCtx.getImageData(0, 0, activeLayer.materialCanvas.width, activeLayer.materialCanvas.height);
    const startX = clamp(Math.floor(x), 0, activeLayer.canvas.width - 1);
    const startY = clamp(Math.floor(y), 0, activeLayer.canvas.height - 1);
    const targetIndex = (startY * activeLayer.canvas.width + startX) * 4;
    const sourcePixels = sourceData?.data || imageData.data;
    const target = sourcePixels.slice(targetIndex, targetIndex + 4);

    const fillColor = this.#colorBytes(this.brush.color, Math.round(this.brush.opacity * 255));
    const materialColor = packedMaterialBytes(this.brush, fillColor[3] / 255);
    const queue = [[startX, startY]];
    const visited = new Uint8Array(activeLayer.canvas.width * activeLayer.canvas.height);

    const matches = (index) => {
      const data = sourcePixels;
      return (
        Math.abs(data[index] - target[0]) <= tolerance &&
        Math.abs(data[index + 1] - target[1]) <= tolerance &&
        Math.abs(data[index + 2] - target[2]) <= tolerance &&
        Math.abs(data[index + 3] - target[3]) <= tolerance
      );
    };

    while (queue.length) {
      const [currentX, currentY] = queue.pop();
      const pointer = currentY * activeLayer.canvas.width + currentX;
      if (visited[pointer]) {
        continue;
      }
      visited[pointer] = 1;
      const index = pointer * 4;
      if (!matches(index)) {
        continue;
      }
      imageData.data[index] = fillColor[0];
      imageData.data[index + 1] = fillColor[1];
      imageData.data[index + 2] = fillColor[2];
      imageData.data[index + 3] = fillColor[3];
      materialData.data[index] = materialColor[0];
      materialData.data[index + 1] = materialColor[1];
      materialData.data[index + 2] = materialColor[2];
      materialData.data[index + 3] = materialColor[3];

      if (currentX > 0) queue.push([currentX - 1, currentY]);
      if (currentX < activeLayer.canvas.width - 1) queue.push([currentX + 1, currentY]);
      if (currentY > 0) queue.push([currentX, currentY - 1]);
      if (currentY < activeLayer.canvas.height - 1) queue.push([currentX, currentY + 1]);
    }

    activeLayer.ctx.putImageData(imageData, 0, 0);
    activeLayer.materialCtx.putImageData(materialData, 0, 0);
    if (alphaMask) {
      this.#restoreAlphaMask(activeLayer, alphaMask);
      this.#restoreMaterialAlphaMask(activeLayer, alphaMask);
    }
    const after = serializeLayerBitmaps(activeLayer);
    this.#pushAction({ type: "layer", label: "Fill", layerId: activeLayer.id, before, after });
    this.#markLayerDirty(activeLayer);
    this.render();
    this.#emitChange("document");
  }

  async #hydrateLayer(document, layer) {
    const hydrated = blankLayer(document.width, document.height, layer.id, layer.name);
    Object.assign(hydrated, layer);
    hydrated.ctx = hydrated.canvas.getContext("2d", { willReadFrequently: true });
    hydrated.materialCtx = hydrated.materialCanvas.getContext("2d", { willReadFrequently: true });

    if (layer.dataUrl) {
      const image = await waitForImageData(layer.dataUrl);
      hydrated.ctx.drawImage(image, 0, 0, document.width, document.height);
    } else if (layer.imageUrl) {
      try {
        const image = await loadImage(layer.imageUrl);
        hydrated.ctx.drawImage(image, 0, 0, document.width, document.height);
      } catch {
        // Keep a blank layer if the asset is missing.
      }
    }

    if (layer.materialDataUrl) {
      const materialImage = await waitForImageData(layer.materialDataUrl);
      hydrated.materialCtx.drawImage(materialImage, 0, 0, document.width, document.height);
    } else if (layer.materialImageUrl) {
      try {
        const materialImage = await loadImage(layer.materialImageUrl);
        hydrated.materialCtx.drawImage(materialImage, 0, 0, document.width, document.height);
      } catch {
        // Keep a blank material layer if the asset is missing.
      }
    }

    return hydrated;
  }

  #drawWorkspaceBackdrop(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#20242b");
    gradient.addColorStop(1, "#0d0f13");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  #drawDocumentSurface(ctx, placement) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.44)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = this.document.background?.mode === "solid"
      ? `${this.document.background.color || "#f3efe5"}`
      : "rgba(246, 242, 233, 0.95)";
    this.#pathRoundedRect(ctx, placement.x, placement.y, placement.width, placement.height, 22);
    ctx.fill();
    ctx.restore();

    ctx.save();
    this.#pathRoundedRect(ctx, placement.x, placement.y, placement.width, placement.height, 22);
    ctx.clip();
    const paperGradient = ctx.createLinearGradient(placement.x, placement.y, placement.x, placement.bottom);
    paperGradient.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    paperGradient.addColorStop(1, "rgba(0, 0, 0, 0.05)");
    ctx.fillStyle = paperGradient;
    ctx.fillRect(placement.x, placement.y, placement.width, placement.height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.26)";
    ctx.lineWidth = 1;
    this.#pathRoundedRect(ctx, placement.x + 0.5, placement.y + 0.5, Math.max(0, placement.width - 1), Math.max(0, placement.height - 1), 22);
    ctx.stroke();
    ctx.restore();
  }

  #drawCheckerboard(ctx, x, y, width, height, size, radius = 0) {
    ctx.save();
    if (radius > 0) {
      this.#pathRoundedRect(ctx, x, y, width, height, radius);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
    }
    ctx.clip();
    for (let row = 0; row < height / size + 2; row += 1) {
      for (let column = 0; column < width / size + 2; column += 1) {
        ctx.fillStyle = (row + column) % 2 === 0 ? "#f2eee4" : "#e5ddcf";
        ctx.fillRect(x + column * size, y + row * size, size, size);
      }
    }
    ctx.restore();
  }

  #pathRoundedRect(ctx, x, y, width, height, radius) {
    const r = clamp(radius, 0, Math.min(width, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  #renderCompositeSurface() {
    this.compositeCtx.clearRect(0, 0, this.document.width, this.document.height);
    if (this.document.background?.mode === "solid") {
      this.compositeCtx.fillStyle = this.document.background.color || "#ffffff";
      this.compositeCtx.fillRect(0, 0, this.document.width, this.document.height);
    }
    for (const layer of this.document.layers) {
      if (!this.#shouldRenderLayer(layer)) {
        continue;
      }
      this.#drawLayerIntoContext(this.compositeCtx, layer);
    }
  }

  #colorBytes(hex, alpha = 255) {
    const normalized = (hex || "#000000").replace("#", "").padStart(6, "0").slice(0, 6);
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
      clamp(alpha, 0, 255),
    ];
  }

  #stampPoint(layer, point, pressure, initial, tilt = this.pendingStroke?.tilt) {
    const assistPoints = this.#getAssistPoints(point);
    let rendered = false;
    for (const assistPoint of assistPoints) {
      if (!this.#pointInsideDocument(assistPoint.point)) {
        continue;
      }
      rendered = true;
      const assistState = this.pendingStroke?.assistStates?.[assistPoint.id] || this.pendingStroke;
      if (assistState && this.pendingStroke) {
        assistState.distance = this.pendingStroke.distance;
      }
      stampBrushDab(layer.ctx, {
        brush: this.brush,
        point: assistPoint.point,
        pressure,
        tilt,
        stroke: assistState,
        sampleCompositeColor: (sampleX, sampleY, radius = 2) => this.#sampleCompositeColor(sampleX, sampleY, radius),
        initial,
        materialCtx: layer.materialCtx,
      });
    }
    const primaryState = this.pendingStroke?.assistStates?.primary;
    if (this.pendingStroke && primaryState) {
      this.pendingStroke.lastAngle = primaryState.lastAngle || this.pendingStroke.lastAngle;
      this.pendingStroke.lastRenderedPoint = primaryState.lastRenderedPoint || this.pendingStroke.lastRenderedPoint;
      if (rendered) {
        this.pendingStroke.renderedStampCount = (this.pendingStroke.renderedStampCount || 0) + 1;
      }
    }
  }

  #sampleCompositeColor(x, y, radius = 2) {
    this.#renderCompositeSurface();
    return this.#sampleAverageColorFromContext(this.compositeCtx, this.compositeCanvas, x, y, radius);
  }

  #sampleAverageColorFromContext(ctx, canvas, x, y, radius = 2) {
    const sampleRadius = Math.max(0, Math.floor(radius));
    const left = clamp(Math.floor(x) - sampleRadius, 0, canvas.width - 1);
    const top = clamp(Math.floor(y) - sampleRadius, 0, canvas.height - 1);
    const right = clamp(Math.floor(x) + sampleRadius, 0, canvas.width - 1);
    const bottom = clamp(Math.floor(y) + sampleRadius, 0, canvas.height - 1);
    const width = Math.max(1, right - left + 1);
    const height = Math.max(1, bottom - top + 1);
    const { data } = ctx.getImageData(left, top, width, height);

    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let totalA = 0;
    let weight = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      const currentWeight = Math.max(alpha, 0.08);
      totalR += data[index] * currentWeight;
      totalG += data[index + 1] * currentWeight;
      totalB += data[index + 2] * currentWeight;
      totalA += data[index + 3];
      weight += currentWeight;
    }

    if (!weight) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }

    return {
      r: totalR / weight,
      g: totalG / weight,
      b: totalB / weight,
      a: totalA / Math.max(1, (data.length / 4)),
    };
  }

  #resolveStrokeConstraint(event, tool) {
    if (!["brush", "eraser", "blend"].includes(tool)) {
      return 0;
    }
    const persistentConstraint = this.getStrokeConstraintDegrees();
    if (persistentConstraint > 0) {
      return persistentConstraint;
    }
    return event?.shiftKey ? 45 : 0;
  }

  #applyStrokeConstraint(point, constraintDegrees) {
    if (!this.pendingStroke || !constraintDegrees) {
      return point;
    }
    const startPoint = this.pendingStroke.startPoint || point;
    const dx = point.x - startPoint.x;
    const dy = point.y - startPoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      return { ...startPoint };
    }
    const step = (constraintDegrees * Math.PI) / 180;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / step) * step;
    return {
      x: startPoint.x + Math.cos(snappedAngle) * distance,
      y: startPoint.y + Math.sin(snappedAngle) * distance,
    };
  }

  #createAssistStates(point, tool) {
    const states = {};
    const sampleRadius = Math.max(2, Math.round(this.brush.size * 0.4));
    for (const assistPoint of this.#getAssistPoints(point)) {
      states[assistPoint.id] = {
        startPoint: assistPoint.point,
        lastPoint: assistPoint.point,
        lastRenderedPoint: assistPoint.point,
        lastAngle: 0,
        distance: 0,
        pickupColor: ["blend", "brush"].includes(tool)
          ? this.#sampleCompositeColor(assistPoint.point.x, assistPoint.point.y, sampleRadius)
          : null,
      };
    }
    return states;
  }

  #getAssistPoints(point) {
    if (!this.document) {
      return [{ id: "primary", point }];
    }

    const width = this.document.width;
    const height = this.document.height;
    const mode = this.getSymmetryMode();
    const candidates = [{ id: "primary", point }];

    if (mode === "vertical" || mode === "quadrant") {
      candidates.push({ id: "mirror-v", point: { x: width - point.x, y: point.y } });
    }
    if (mode === "horizontal" || mode === "quadrant") {
      candidates.push({ id: "mirror-h", point: { x: point.x, y: height - point.y } });
    }
    if (mode === "quadrant") {
      candidates.push({ id: "mirror-both", point: { x: width - point.x, y: height - point.y } });
    }

    const uniquePoints = [];
    for (const candidate of candidates) {
      if (uniquePoints.some((existing) => Math.abs(existing.point.x - candidate.point.x) < 0.1 && Math.abs(existing.point.y - candidate.point.y) < 0.1)) {
        continue;
      }
      uniquePoints.push(candidate);
    }
    return uniquePoints;
  }

  #pointInsideDocument(point) {
    return Boolean(
      this.document
      && point.x >= 0
      && point.y >= 0
      && point.x <= this.document.width
      && point.y <= this.document.height
    );
  }

  #captureAlphaMask(layer) {
    const { data } = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const alphaMask = new Uint8ClampedArray(layer.canvas.width * layer.canvas.height);
    for (let index = 0; index < alphaMask.length; index += 1) {
      alphaMask[index] = data[index * 4 + 3];
    }
    return alphaMask;
  }

  #restoreAlphaMask(layer, alphaMask) {
    const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    for (let index = 0; index < alphaMask.length; index += 1) {
      const offset = index * 4;
      const alpha = alphaMask[index];
      if (alpha === 0) {
        imageData.data[offset] = 0;
        imageData.data[offset + 1] = 0;
        imageData.data[offset + 2] = 0;
      }
      imageData.data[offset + 3] = alpha;
    }
    layer.ctx.putImageData(imageData, 0, 0);
  }

  #restoreMaterialAlphaMask(layer, alphaMask) {
    const imageData = layer.materialCtx.getImageData(0, 0, layer.materialCanvas.width, layer.materialCanvas.height);
    for (let index = 0; index < alphaMask.length; index += 1) {
      const offset = index * 4;
      const alpha = alphaMask[index];
      if (alpha === 0) {
        imageData.data[offset] = 0;
        imageData.data[offset + 1] = 0;
        imageData.data[offset + 2] = 0;
      }
      imageData.data[offset + 3] = alpha;
    }
    layer.materialCtx.putImageData(imageData, 0, 0);
  }

  #drawLayerIntoContext(ctx, layer) {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.globalCompositeOperation = mapCanvasBlendMode(layer.blendMode);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  #shouldRenderLayer(layer) {
    if (this.hasSoloLayer()) {
      return layer.id === this.soloLayerId;
    }
    return layer.visible !== false;
  }

  #pushAction(action) {
    this.historyUndo.push(action);
    this.historyRedo = [];
  }

  async #applyAction(action, direction) {
    if (action.type === "layer") {
      const layer = this.document.layers.find((item) => item.id === action.layerId);
      if (!layer) {
        return;
      }
      const payload = normalizeLayerBitmaps(direction === "undo" ? action.before : action.after);
      const image = await waitForImageData(payload.color);
      layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.ctx.drawImage(image, 0, 0);
      layer.materialCtx.clearRect(0, 0, layer.materialCanvas.width, layer.materialCanvas.height);
      if (payload.material) {
        const materialImage = await waitForImageData(payload.material);
        layer.materialCtx.drawImage(materialImage, 0, 0);
      }
      this.#markLayerDirty(layer);
      return;
    }

    if (action.type === "snapshot") {
      await this.#restoreSnapshot(direction === "undo" ? action.before : action.after);
    }
  }

  async #restoreSnapshot(snapshot) {
    const hydratedLayers = [];
    for (const layerMeta of snapshot.document.layers) {
      const bitmaps = normalizeLayerBitmaps(snapshot.layers[layerMeta.id]);
      hydratedLayers.push(await this.#hydrateLayer(snapshot.document, {
        ...layerMeta,
        dataUrl: bitmaps.color,
        materialDataUrl: bitmaps.material,
      }));
    }
    this.document = {
      ...snapshot.document,
      assist: normalizeAssist(snapshot.document.assist),
      layers: hydratedLayers,
    };
    this.dirtyLayerIds = new Set(this.document.layers.map((layer) => layer.id));
    this.#syncLayerPreviewState();
    this.#emitChange("document");
  }

  #touchLayer(layer) {
    layer.thumbnailVersion = Number(layer.thumbnailVersion || 0) + 1;
    layer.updatedAt = nowIso();
  }

  #markLayerDirty(layer) {
    this.#touchLayer(layer);
    this.dirtyLayerIds.add(layer.id);
  }

  #syncLayerPreviewState() {
    if (!this.document?.layers.some((layer) => layer.id === this.soloLayerId)) {
      this.soloLayerId = "";
    }
  }

  #emitChange(reason) {
    this.onChange?.(reason, this);
  }
}
