import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";

import { createDocument, exportProject, importProject, loadDocument, saveDocument } from "./api.js";
import {
  getBrushPreviewSignature,
  paintSampleSurface,
  renderBrushStrokeSample,
  sampleCanvasColor,
} from "./brush-preview.js";
import {
  buildBrushPresetFromBrush,
  isBuiltInBrushPresetId,
  loadCustomBrushPresets,
  makeUniqueBrushPresetLabel,
  saveCustomBrushPresets,
} from "./brush-presets-store.js";
import {
  BRUSH_EDITOR_CONTROLS,
  BRUSH_EDITOR_SECTIONS,
  getBrushEditorAssistMessage,
  getBrushEditorControlDisplayValue,
  getBrushEditorControlOptions,
  getBrushEditorControlPatch,
  getBrushEditorControlValue,
  getBrushEditorSectionMeta,
  getBrushEditorSectionsForBrush,
  isBrushEditorControlVisible,
} from "./brush-editor-schema.js";
import { stampBrushDab } from "./brush-stamp.js";
import { CanvasEngine } from "./canvas-engine.js";
import { ColorWheelControl } from "./color-wheel.js";
import { createProjectBundleBlob, getProjectBundleFilename, readProjectBundleFile } from "./project-file.js";
import {
  API_PREFIX,
  BLEND_MODES,
  BRUSH_PRESETS,
  CANVAS_SYMMETRY_OPTIONS,
  DEFAULT_SWATCHES,
  KEY_HINTS,
  STROKE_CONSTRAINT_OPTIONS,
  TOOL_DESCRIPTIONS,
  TOOLS,
} from "./constants.js";
import {
  button,
  createField,
  layerBadge,
  select,
  slider,
  textInput,
} from "./ui-primitives.js";
import {
  downloadBlob,
  formatLibraryGroupLabel,
  formatPercent,
  formatRotation,
  getNextStrokeConstraint,
  getNextSymmetryMode,
  getPresetScopeForTool,
  getStrokeConstraintLabel,
  getSymmetryLabel,
  getWidgetValue,
  isStrokeTool,
  isTextEntryElement,
  roundedRectPath,
  setWidgetValue,
} from "./studio-helpers.js";
import {
  clampFreePanelPosition,
  computeSplitArtboardLayout,
  getShellBounds,
  resolveAnchoredPanelPosition,
  SPLIT_ARTBOARD_GAP,
} from "./studio-layout.js";

let stylesInjected = false;

function wrapCanvasText(ctx, text, maxWidth, maxLines = 2) {
  const content = String(text || "").trim();
  if (!content) {
    return [];
  }
  if (maxWidth <= 0) {
    return [content];
  }

  const words = content.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = words.shift() || "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      return;
    }
    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const truncated = lines.slice(0, maxLines);
  while (
    truncated[maxLines - 1].length > 1
    && ctx.measureText(`${truncated[maxLines - 1]}…`).width > maxWidth
  ) {
    truncated[maxLines - 1] = truncated[maxLines - 1].slice(0, -1);
  }
  truncated[maxLines - 1] = `${truncated[maxLines - 1].replace(/[.,;:!?\\s]+$/u, "")}…`;
  return truncated;
}

function createHistoryIcon(direction) {
  const svgNs = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNs, "svg");
  icon.classList.add("cp-history-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute(
    "d",
    direction === "undo"
      ? "M6.6 3.4 3.4 6.6l3.2 3.2M3.7 6.6h4.9c2.5 0 4.5 2 4.5 4.5"
      : "M9.4 3.4l3.2 3.2-3.2 3.2M12.3 6.6H7.4c-2.5 0-4.5 2-4.5 4.5",
  );
  icon.append(path);
  return icon;
}

function decorateHistoryButton(buttonElement, direction) {
  const label = buttonElement.textContent || "";
  buttonElement.textContent = "";
  buttonElement.classList.add("cp-button--with-glyph");
  const labelElement = document.createElement("span");
  labelElement.className = "cp-button__label";
  labelElement.textContent = label;
  buttonElement.append(createHistoryIcon(direction), labelElement);
}

function syncSelectOptions(inputElement, options, nextValue) {
  if (!(inputElement instanceof HTMLSelectElement)) {
    return;
  }

  const normalizedOptions = options.map((item) => (
    typeof item === "string"
      ? { value: item, label: item }
      : item
  ));
  const currentSignature = Array.from(inputElement.options)
    .map((option) => `${option.value}:${option.textContent}`)
    .join("|");
  const nextSignature = normalizedOptions
    .map((option) => `${option.value}:${option.label}`)
    .join("|");
  if (currentSignature !== nextSignature) {
    inputElement.replaceChildren();
    normalizedOptions.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      inputElement.appendChild(option);
    });
  }

  inputElement.value = String(nextValue ?? normalizedOptions[0]?.value ?? "");
}

function resolvePreviewTiltState(event, fallback = { x: 0, y: 0, magnitude: 0, angle: 0 }) {
  if (!event || (event.pointerType && event.pointerType !== "pen")) {
    return fallback;
  }
  const tiltX = Number.isFinite(event.tiltX) ? event.tiltX : 0;
  const tiltY = Number.isFinite(event.tiltY) ? event.tiltY : 0;
  const magnitude = Math.min(1, Math.max(0, Math.hypot(tiltX, tiltY) / 90));
  const angle = magnitude > 0.0001 ? Math.atan2(tiltY, tiltX) : (fallback?.angle ?? 0);
  return {
    x: tiltX,
    y: tiltY,
    magnitude,
    angle,
  };
}

export function ensureStudioStyles() {
  if (stylesInjected) {
    return;
  }
  ["./design-system.css", "./styles.css"].forEach((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = new URL(href, import.meta.url).href;
    document.head.appendChild(link);
  });
  stylesInjected = true;
}

export class ComfyPencilStudioOverlay {
  constructor() {
    ensureStudioStyles();
    this.node = null;
    this.pendingSaveTimer = 0;
    this.savingPromise = null;
    this.spacePanning = false;
    this.isOpen = false;
    this.ignoreEngineChanges = false;
    this.autoSaveMs = 900;
    this.needsSave = false;
    this.showCanvasGuides = true;
    this.brushEditorOpen = false;
    this.panelState = {
      brushLibrary: false,
      layers: false,
      color: false,
      document: false,
      interfaceHidden: false,
    };
    this.splitViewEnabled = false;
    this.streamRefreshTimer = 0;
    this.streamAutoRunTimer = 0;
    this.streamAutoRunSeconds = 5;
    this.streamQueueRemaining = 0;
    this.streamQueuePrimedUntil = 0;
    this.streamQueueRequestPending = false;
    this.streamAutoRunActive = false;
    this.streamActivePromptId = "";
    this.streamStopRequested = false;
    this.streamRuntimeBound = false;
    this.streamPreviewRequestId = 0;
    this.quickMenuOpen = false;
    this.lastPointerClient = {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2),
    };
    this.panelPositions = {};
    this.panelDragState = null;
    this.brushEditorSection = "stroke";
    this.brushPreviewPadDirty = false;
    this.brushPreviewStroke = null;
    this.incomingStreamState = {
      connected: false,
      sourceNodeId: 0,
      sourceTitle: "",
      previewKey: "",
      previewUrls: [],
      previewUrl: "",
      status: "Run the receiver node to update this preview.",
    };
    this.sidebarPosition = 152;
    this.colorHistory = [];
    this.previousColor = "#ffffff";
    this.lastSyncedBrushColor = "";
    this.panelButtons = {};
    this.brushControlRegistry = {};
    this.cursorState = {
      visible: false,
      insideDocument: false,
      localX: 0,
      localY: 0,
      docX: 0,
      docY: 0,
    };

    this.root = document.createElement("div");
    this.root.className = "cp-root";
    this.root.innerHTML = `
      <div class="cp-backdrop"></div>
      <div class="cp-shell">
        <header class="cp-header"></header>
        <aside class="cp-toolbar"></aside>
        <section class="cp-stage">
          <div class="cp-stage__workspace">
            <div class="cp-stage__guidebox">
              <div class="cp-stage__guide cp-stage__guide--v"></div>
              <div class="cp-stage__guide cp-stage__guide--h"></div>
            </div>
            <div class="cp-stage__stroke-guide" hidden></div>
            <div class="cp-stage__stroke-guide-label" hidden></div>
            <div class="cp-stage__dock">
              <div class="cp-stage__readout">
                <div class="cp-stage__coords"></div>
                <div class="cp-stage__viewport">
                  <div class="cp-stage__chip" data-chip="tool"></div>
                  <div class="cp-stage__chip" data-chip="layer"></div>
                  <div class="cp-stage__chip" data-chip="zoom"></div>
                </div>
              </div>
            </div>
            <div class="cp-stage__navigator">
              <div class="cp-stage__navigator-meta"></div>
              <canvas class="cp-stage__navigator-canvas" width="220" height="148"></canvas>
            </div>
            <div class="cp-stage__cursor" hidden>
              <div class="cp-stage__cursor-ring"></div>
              <div class="cp-stage__cursor-dot"></div>
            </div>
            <canvas class="cp-stage__canvas"></canvas>
            <aside class="cp-stage__split-board" hidden>
              <div class="cp-stage__split-surface">
                <canvas class="cp-stage__split-canvas" width="1024" height="1024"></canvas>
                <div class="cp-stage__split-empty" hidden></div>
              </div>
            </aside>
            <div class="cp-stage__split-toolbar" hidden>
              <div class="cp-stage__split-meta">
                <div class="cp-stage__split-title">Downstream Preview</div>
                <div class="cp-stage__split-status"></div>
              </div>
              <div class="cp-stage__split-actions">
                <button type="button" class="cp-button cp-button--ghost cp-button--tiny" data-split-action="refresh">Refresh</button>
                <button type="button" class="cp-button cp-button--tiny" data-split-action="autorun">Active Run</button>
                <select class="cp-stage__split-select" data-split-action="interval" aria-label="Active run interval">
                  <option value="3">3s</option>
                  <option value="5" selected>5s</option>
                  <option value="10">10s</option>
                </select>
                <button type="button" class="cp-button cp-button--ghost cp-button--tiny" data-split-action="stop">Stop</button>
                <button type="button" class="cp-button cp-button--tiny" data-split-action="export">Export to Canvas</button>
              </div>
            </div>
          </div>
        </section>
        <div class="cp-quick-menu" hidden></div>
        <aside class="cp-inspector"></aside>
      </div>
    `;
    document.body.appendChild(this.root);

    this.header = this.root.querySelector(".cp-header");
    this.toolbar = this.root.querySelector(".cp-toolbar");
    this.stageShell = this.root.querySelector(".cp-stage");
    this.streamPane = this.root.querySelector(".cp-stage__split-board");
    this.streamPaneTitle = this.root.querySelector(".cp-stage__split-title");
    this.streamPaneStatus = this.root.querySelector(".cp-stage__split-status");
    this.streamPaneCanvas = this.root.querySelector(".cp-stage__split-canvas");
    this.streamPaneEmpty = this.root.querySelector(".cp-stage__split-empty");
    this.streamPaneSurface = this.root.querySelector(".cp-stage__split-surface");
    this.streamPaneToolbar = this.root.querySelector(".cp-stage__split-toolbar");
    this.streamRefreshButton = this.root.querySelector('[data-split-action="refresh"]');
    this.streamAutoRunButton = this.root.querySelector('[data-split-action="autorun"]');
    this.streamIntervalSelect = this.root.querySelector('[data-split-action="interval"]');
    this.streamStopButton = this.root.querySelector('[data-split-action="stop"]');
    this.streamExportButton = this.root.querySelector('[data-split-action="export"]');
    this.stage = this.root.querySelector(".cp-stage__workspace");
    this.canvas = this.root.querySelector(".cp-stage__canvas");
    this.quickMenu = this.root.querySelector(".cp-quick-menu");
    this.inspector = this.root.querySelector(".cp-inspector");
    this.toolChip = this.root.querySelector('[data-chip="tool"]');
    this.layerChip = this.root.querySelector('[data-chip="layer"]');
    this.zoomChip = this.root.querySelector('[data-chip="zoom"]');
    this.guideBox = this.root.querySelector(".cp-stage__guidebox");
    this.strokeGuide = this.root.querySelector(".cp-stage__stroke-guide");
    this.strokeGuideLabel = this.root.querySelector(".cp-stage__stroke-guide-label");
    this.canvasCoords = this.root.querySelector(".cp-stage__coords");
    this.navigatorCard = this.root.querySelector(".cp-stage__navigator");
    this.navigatorMeta = this.root.querySelector(".cp-stage__navigator-meta");
    this.navigatorCanvas = this.root.querySelector(".cp-stage__navigator-canvas");
    this.cursorElement = this.root.querySelector(".cp-stage__cursor");
    this.cursorRing = this.root.querySelector(".cp-stage__cursor-ring");
    this.cursorDot = this.root.querySelector(".cp-stage__cursor-dot");

    this.engine = new CanvasEngine(this.canvas, {
      onChange: (reason) => this.handleEngineChange(reason),
    });
    this.customBrushPresets = loadCustomBrushPresets();
    this.engine.setBrushPresets(this.getBrushPresets());

    this.colorWheel = new ColorWheelControl({
      onPreview: (hex) => {
        this.previewWheelColor(hex);
      },
      onCommit: (hex) => {
        this.engine.setBrushColor(hex);
        this.syncBrushControls();
        this.syncSwatches();
      },
    });

    this.#buildHeader();
    this.#buildToolbar();
    this.#buildInspector();
    this.#buildQuickMenu();
    this.#bindEvents();
    this.bindIncomingStreamRuntime();
    this.syncIncomingStreamControls();
    this.refreshPanelVisibility();
  }

  async openForNode(node, { autoSaveMs = 900 } = {}) {
    if (this.isOpen && this.node && this.node !== node) {
      try {
        await this.saveNow();
      } catch {
        // Leave the current status badge intact and continue switching nodes.
      }
    }
    this.node = node;
    this.autoSaveMs = autoSaveMs;
    this.isOpen = true;
    this.closeBrushEditor();
    this.splitViewEnabled = false;
    await this.stopIncomingStreamAutoRun({ interrupt: false, silent: true });
    this.stopIncomingStreamPolling();
    this.incomingStreamState = {
      connected: false,
      sourceNodeId: 0,
      sourceTitle: "",
      previewKey: "",
      previewUrls: [],
      previewUrl: "",
      status: "Run the receiver node to update this preview.",
    };
    this.panelState.interfaceHidden = false;
    this.panelState.brushLibrary = true;
    this.panelState.layers = false;
    this.panelState.color = false;
    this.panelState.document = false;
    this.colorHistory = [];
    this.previousColor = "#ffffff";
    this.lastSyncedBrushColor = "";
    this.root.classList.add("cp-open");
    this.setStatus("Loading document");

    const document = await this.#ensureDocumentLoaded();
    this.ignoreEngineChanges = true;
    await this.engine.loadDocument(document);
    this.ignoreEngineChanges = false;
    this.needsSave = false;
    this.colorWheel.setHex(this.engine.brush.color, { silent: true });
    this.refreshAll();
    this.setStatus(`Ready · ${document.layers.length} layer${document.layers.length === 1 ? "" : "s"}`);
    this.nameInput.focus({ preventScroll: true });
  }

  async close() {
    if (!this.isOpen) {
      return;
    }
    window.clearTimeout(this.pendingSaveTimer);
    this.pendingSaveTimer = 0;
    if (this.savingPromise) {
      try {
        await this.savingPromise;
      } catch {
        // Keep the last autosave error in the status badge but still allow closing.
      }
    }
    this.isOpen = false;
    this.root.classList.remove("cp-open");
    this.closeBrushEditor();
    await this.stopIncomingStreamAutoRun({ interrupt: false, silent: true });
    this.toggleInterfaceHidden(false);
    this.toggleSplitView(false);
    this.stopIncomingStreamPolling();
    this.hideCanvasCursor();
  }

  async saveNow({ force = false } = {}) {
    if (!this.node || !this.engine.document) {
      return;
    }
    if (this.savingPromise) {
      return this.savingPromise;
    }
    if (!force && !this.needsSave) {
      return;
    }

    const documentId = this.engine.document.id;
    if (!documentId) {
      return;
    }

    const payloadDocument = this.engine.serializeDocument();
    const layerImages = this.engine.takeDirtyLayerPayloads();

    this.setStatus("Saving");
    this.savingPromise = saveDocument(documentId, payloadDocument, layerImages)
      .then((savedDocument) => {
        this.engine.markSaved(savedDocument);
        this.#syncNodeWidgets(savedDocument);
        this.refreshAll();
        this.needsSave = false;
        this.setStatus(`Saved · rev ${savedDocument.revision}`);
      })
      .catch((error) => {
        this.setStatus(`Save failed · ${error.message}`);
        throw error;
      })
      .finally(() => {
        this.savingPromise = null;
      });

    return this.savingPromise;
  }

  async saveProjectFile() {
    const documentId = String(this.engine?.document?.id || "").trim();
    if (!documentId) {
      throw new Error("No active document to export.");
    }
    await this.saveNow({ force: true });
    const project = await exportProject(documentId);
    const blob = createProjectBundleBlob(project);
    downloadBlob(blob, getProjectBundleFilename(project.document?.name || this.engine.document?.name || "untitled_sketch"));
    this.setStatus(`Project exported · ${project.document?.name || "Untitled Sketch"}`);
  }

  async openProjectFile(file) {
    if (!file) {
      return;
    }
    await this.saveNow().catch(() => {});
    this.setStatus(`Opening project · ${file.name}`);
    const project = await readProjectBundleFile(file);
    const importedDocument = await importProject(project);
    window.clearTimeout(this.pendingSaveTimer);
    this.pendingSaveTimer = 0;
    this.ignoreEngineChanges = true;
    await this.engine.loadDocument(importedDocument);
    this.ignoreEngineChanges = false;
    this.needsSave = false;
    this.colorWheel.setHex(this.engine.brush.color, { silent: true });
    this.#syncNodeWidgets(importedDocument);
    this.refreshAll();
    this.setStatus(`Project opened · ${importedDocument.name} · ${importedDocument.layers.length} layer${importedDocument.layers.length === 1 ? "" : "s"}`);
  }

  handleEngineChange(reason) {
    if (this.ignoreEngineChanges || !this.isOpen) {
      return;
    }

    if (reason === "brush") {
      this.syncBrushControls();
      this.syncSwatches();
      this.refreshViewportChips();
      return;
    }

    if (reason === "viewport") {
      this.refreshViewportChips();
      return;
    }

    if (reason === "layer-preview") {
      this.refreshAll();
      return;
    }

    this.refreshAll();
    this.scheduleSave();
  }

  scheduleSave() {
    if (!this.node || !this.engine.document?.id) {
      return;
    }
    window.clearTimeout(this.pendingSaveTimer);
    this.needsSave = true;
    this.setStatus("Unsaved changes");
    this.pendingSaveTimer = window.setTimeout(() => {
      this.saveNow().catch(() => {});
    }, this.autoSaveMs);
  }

  refreshAll() {
    this.refreshDocumentMeta();
    this.syncBrushControls();
    this.syncSwatches();
    this.renderLayerList();
    this.renderBrushLibrary();
    this.renderColorHistory();
    if (this.splitViewEnabled) {
      this.refreshIncomingStream();
    }
    Object.keys(this.panelRegistry || {}).forEach((panelName) => this.syncPanelPosition(panelName));
    this.refreshPanelVisibility();
    this.refreshViewportChips();
  }

  getCanvasAssistParts({ includeNeutralRotation = false } = {}) {
    const parts = [];
    const rotation = this.engine.getRotationDegrees();
    const symmetry = this.engine.getSymmetryMode();
    const strokeConstraint = this.engine.getStrokeConstraintDegrees();
    if (includeNeutralRotation || Math.abs(rotation) >= 0.1) {
      parts.push(formatRotation(rotation));
    }
    if (symmetry !== "off") {
      parts.push(getSymmetryLabel(symmetry));
    }
    if (strokeConstraint > 0) {
      parts.push(getStrokeConstraintLabel(strokeConstraint));
    }
    return parts.filter(Boolean);
  }

  refreshDocumentMeta() {
    const document = this.engine.document;
    if (!document) {
      return;
    }
    this.nameInput.value = document.name || "Untitled Sketch";
    this.metaLabel.textContent = `${document.width} × ${document.height} px`;
    this.docPill.textContent = `rev ${document.revision || 0}`;
    const previewState = this.engine.hasSoloLayer() ? "solo preview" : (document.background?.mode === "solid" ? "paper" : "transparent");
    const assistParts = this.getCanvasAssistParts();
    this.docSummary.textContent = `${document.layers.length} layer${document.layers.length === 1 ? "" : "s"} · ${previewState}${assistParts.length ? ` · ${assistParts.join(" · ")}` : ""}`;
    this.backgroundModeSelect.value = document.background?.mode || "transparent";
    this.backgroundColorInput.value = document.background?.color || "#ffffff";
    this.canvasRotationInput.value = String(this.engine.getRotationDegrees());
    this.canvasRotationLabel.textContent = formatRotation(this.engine.getRotationDegrees());
    this.symmetryModeSelect.value = this.engine.getSymmetryMode();
    this.strokeConstraintSelect.value = String(this.engine.getStrokeConstraintDegrees());
    this.hexInput.value = this.engine.brush.color;
    this.colorPreview.style.background = this.engine.brush.color;
    const activeLayer = this.engine.getActiveLayer();
    const activeIndex = this.engine.getActiveLayerIndex();
    const mergeTarget = activeIndex > 0 ? document.layers[activeIndex - 1] : null;
    this.layerDuplicateButton.disabled = !activeLayer;
    this.layerDeleteButton.disabled = !activeLayer || document.layers.length <= 1;
    this.layerClearButton.disabled = !activeLayer || activeLayer.locked;
    this.layerMergeButton.disabled = !activeLayer || activeIndex <= 0 || activeLayer.locked || Boolean(mergeTarget?.locked);
  }

  refreshViewportChips() {
    const activeLayer = this.engine.getActiveLayer();
    const activeTool = TOOLS.find((tool) => tool.id === this.engine.brush.tool);
    if (this.toolChip) {
      this.toolChip.textContent = `${activeTool?.label || "Brush"} · ${KEY_HINTS[this.engine.brush.tool] || ""}`.trim();
    }
    if (!activeLayer) {
      if (this.layerChip) {
        this.layerChip.textContent = "Layer";
      }
    } else {
      const states = [];
      if (activeLayer.locked) {
        states.push("locked");
      }
      if (activeLayer.alphaLocked) {
        states.push("alpha");
      }
      if (this.engine.isLayerSolo(activeLayer.id)) {
        states.push("solo");
      }
      if (this.layerChip) {
        this.layerChip.textContent = `Layer · ${activeLayer.name}${states.length ? ` · ${states.join(" / ")}` : ""}`;
      }
    }
    if (this.zoomChip) {
      this.zoomChip.textContent = `${Math.round(this.engine.view.zoom * 100)}% zoom`;
    }
    this.refreshCanvasOverlay();
  }

  syncSplitStageReserve() {
    if (!this.root) {
      return false;
    }

    const nextValue = "0px";
    if (this.root.style.getPropertyValue("--cp-stage-split-reserve") === nextValue) {
      return false;
    }
    this.root.style.setProperty("--cp-stage-split-reserve", nextValue);
    return true;
  }

  refreshCanvasOverlay() {
    const document = this.engine.document;
    if (!document) {
      return;
    }

    const splitReserveChanged = this.syncSplitStageReserve();
    if (splitReserveChanged) {
      this.engine.render();
    }

    const placement = this.engine.getCanvasPlacement();
    if (!placement) {
      return;
    }

    this.guideBox.hidden = !this.showCanvasGuides;
    this.guideBox.style.left = `${placement.x}px`;
    this.guideBox.style.top = `${placement.y}px`;
    this.guideBox.style.width = `${placement.width}px`;
    this.guideBox.style.height = `${placement.height}px`;
    this.guideBox.style.transform = `rotate(${this.engine.getRotationDegrees()}deg)`;
    this.guideBox.dataset.symmetry = this.engine.getSymmetryMode();
    this.canvasGuidesQuickButton?.classList.toggle("cp-active", this.showCanvasGuides);
    this.canvasActualQuickButton?.classList.toggle("cp-active", Math.abs(this.engine.view.zoom - 1) < 0.025);
    const navigatorParts = [
      `${document.width} × ${document.height}`,
      document.background?.mode === "solid" ? "paper" : "alpha",
      ...this.getCanvasAssistParts({ includeNeutralRotation: true }),
    ].filter(Boolean);
    this.navigatorMeta.textContent = navigatorParts.join(" · ");
    this.renderNavigator();
    this.renderStrokeGuide();
    this.renderCanvasCursor();
    this.layoutSplitArtboard();
    this.redrawIncomingStreamArtboard();
    this.refreshCanvasReadout();
  }

  renderNavigator() {
    const document = this.engine.document;
    const previewCanvas = this.engine.getCompositePreviewCanvas();
    if (!document || !previewCanvas) {
      return;
    }

    const ctx = this.navigatorCanvas.getContext("2d");
    const width = this.navigatorCanvas.width;
    const height = this.navigatorCanvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, width, height);

    const inset = 12;
    const innerWidth = width - (inset * 2);
    const innerHeight = height - (inset * 2);
    const scale = Math.min(innerWidth / document.width, innerHeight / document.height);
    const drawWidth = document.width * scale;
    const drawHeight = document.height * scale;
    const drawX = (width - drawWidth) / 2;
    const drawY = (height - drawHeight) / 2;

    if (document.background?.mode !== "solid") {
      const tile = 8;
      for (let row = 0; row < drawHeight / tile + 1; row += 1) {
        for (let column = 0; column < drawWidth / tile + 1; column += 1) {
          ctx.fillStyle = (row + column) % 2 === 0 ? "#e8e0d1" : "#f4efe5";
          ctx.fillRect(drawX + column * tile, drawY + row * tile, tile, tile);
        }
      }
    } else {
      ctx.fillStyle = document.background.color || "#f3efe5";
      ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
    }

    ctx.drawImage(previewCanvas, drawX, drawY, drawWidth, drawHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(drawX + 0.5, drawY + 0.5, Math.max(0, drawWidth - 1), Math.max(0, drawHeight - 1));

    const symmetryMode = this.engine.getSymmetryMode();
    if (symmetryMode === "vertical" || symmetryMode === "quadrant") {
      ctx.strokeStyle = "rgba(126, 109, 255, 0.75)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(drawX + (drawWidth / 2), drawY + 6);
      ctx.lineTo(drawX + (drawWidth / 2), drawY + drawHeight - 6);
      ctx.stroke();
    }
    if (symmetryMode === "horizontal" || symmetryMode === "quadrant") {
      ctx.strokeStyle = "rgba(246, 129, 79, 0.72)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(drawX + 6, drawY + (drawHeight / 2));
      ctx.lineTo(drawX + drawWidth - 6, drawY + (drawHeight / 2));
      ctx.stroke();
    }

    const visibleRect = this.engine.getVisibleDocumentRect();
    if (visibleRect) {
      ctx.strokeStyle = "rgba(74, 167, 255, 0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        drawX + (visibleRect.left * scale) + 1,
        drawY + (visibleRect.top * scale) + 1,
        Math.max(6, visibleRect.width * scale - 2),
        Math.max(6, visibleRect.height * scale - 2),
      );
    }
  }

  updateCanvasCursor(event) {
    if (!this.engine.document) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const insideCanvas = localX >= 0 && localY >= 0 && localX <= rect.width && localY <= rect.height;
    const docPoint = this.engine.screenToDoc(event.clientX, event.clientY);
    const insideDocument = insideCanvas
      && docPoint.x >= 0
      && docPoint.y >= 0
      && docPoint.x <= this.engine.document.width
      && docPoint.y <= this.engine.document.height;

    this.cursorState = {
      visible: insideCanvas && this.engine.brush.tool !== "pan",
      insideDocument,
      localX,
      localY,
      docX: docPoint.x,
      docY: docPoint.y,
    };
    this.renderCanvasCursor();
    this.refreshCanvasReadout();
  }

  hideCanvasCursor() {
    this.cursorState.visible = false;
    this.renderCanvasCursor();
    this.refreshCanvasReadout();
  }

  renderCanvasCursor() {
    const brush = this.engine.brush;
    const visible = this.cursorState.visible && this.cursorState.insideDocument;
    this.cursorElement.hidden = !visible;
    if (!visible) {
      return;
    }

    const tool = brush.tool;
    const shape = Math.max(12, brush.size * this.engine.view.zoom);
    const shapeHeight = Math.max(12, shape * (brush.roundness ?? 1));
    const isPicker = tool === "eyedropper" || tool === "fill";
    const width = isPicker ? 18 : shape;
    const height = isPicker ? 18 : shapeHeight;
    const angle = (this.engine.pendingStroke?.assistStates?.primary?.lastAngle || this.engine.pendingStroke?.lastAngle || 0)
      + this.engine.getRotationRadians();

    this.cursorElement.style.left = `${this.cursorState.localX}px`;
    this.cursorElement.style.top = `${this.cursorState.localY}px`;
    this.cursorElement.classList.toggle("cp-stage__cursor--eraser", tool === "eraser");
    this.cursorElement.classList.toggle("cp-stage__cursor--blend", tool === "blend");
    this.cursorElement.classList.toggle("cp-stage__cursor--picker", isPicker);
    this.cursorRing.style.width = `${width}px`;
    this.cursorRing.style.height = `${height}px`;
    this.cursorRing.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    this.cursorDot.hidden = width > 18;
  }

  renderStrokeGuide() {
    const guide = this.engine.getPendingStrokeGuide();
    const visible = Boolean(guide && guide.length > 2);
    this.strokeGuide.hidden = !visible;
    this.strokeGuideLabel.hidden = !visible;
    if (!visible) {
      return;
    }

    const startPoint = this.engine.docToScreen(guide.startPoint.x, guide.startPoint.y);
    const endPoint = this.engine.docToScreen(guide.endPoint.x, guide.endPoint.y);
    const dx = endPoint.localX - startPoint.localX;
    const dy = endPoint.localY - startPoint.localY;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const labelX = startPoint.localX + (dx / 2);
    const labelY = startPoint.localY + (dy / 2);

    this.strokeGuide.style.left = `${startPoint.localX}px`;
    this.strokeGuide.style.top = `${startPoint.localY}px`;
    this.strokeGuide.style.width = `${length}px`;
    this.strokeGuide.style.transform = `translateY(-50%) rotate(${angle}rad)`;
    this.strokeGuideLabel.style.left = `${labelX}px`;
    this.strokeGuideLabel.style.top = `${labelY}px`;
    this.strokeGuideLabel.textContent = `${getStrokeConstraintLabel(guide.constraintDegrees)} · ${Math.round(guide.length)} px`;
  }

  refreshCanvasReadout() {
    const document = this.engine.document;
    if (!document) {
      return;
    }
    const readoutParts = [
      `${Math.round(this.engine.brush.size)} px`,
      ...this.getCanvasAssistParts({ includeNeutralRotation: true }),
    ];
    if (this.cursorState.visible && this.cursorState.insideDocument) {
      this.canvasCoords.textContent = [
        `X ${Math.round(this.cursorState.docX)}`,
        `Y ${Math.round(this.cursorState.docY)}`,
        ...readoutParts,
      ].join(" · ");
      return;
    }
    this.canvasCoords.textContent = [
      `${document.width} × ${document.height}`,
      ...readoutParts,
    ].filter(Boolean).join(" · ");
  }

  getBrushPresets() {
    return [...BRUSH_PRESETS, ...(this.customBrushPresets || [])];
  }

  findBrushPreset(presetId = this.engine?.brush?.presetId) {
    return this.getBrushPresets().find((preset) => preset.id === presetId) || null;
  }

  getScopedBrushPresets(tool = this.engine?.brush?.tool) {
    const presetScope = getPresetScopeForTool(tool);
    if (!presetScope) {
      return [];
    }
    return this.getBrushPresets().filter((preset) => preset.tool === presetScope);
  }

  persistCustomBrushPresets() {
    saveCustomBrushPresets(this.customBrushPresets || []);
    this.engine.setBrushPresets(this.getBrushPresets());
  }

  createPresetFromActiveBrush({
    id,
    label,
    libraryGroup,
    sourcePreset = this.findBrushPreset(),
  } = {}) {
    return buildBrushPresetFromBrush(this.engine?.brush, {
      id,
      label,
      libraryGroup,
      sourcePreset,
    });
  }

  upsertCustomBrushPreset(preset) {
    if (!preset) {
      return null;
    }
    const existingIndex = (this.customBrushPresets || []).findIndex((item) => item.id === preset.id);
    if (existingIndex >= 0) {
      this.customBrushPresets = this.customBrushPresets.map((item, index) => (index === existingIndex ? preset : item));
    } else {
      this.customBrushPresets = [...(this.customBrushPresets || []), preset];
    }
    this.persistCustomBrushPresets();
    return preset;
  }

  createNewBrushPreset() {
    const scope = getPresetScopeForTool(this.engine?.brush?.tool) || "brush";
    const scopedPresets = this.getScopedBrushPresets(scope);
    const sourcePreset = scopedPresets[0] || this.findBrushPreset() || BRUSH_PRESETS[0];
    const presetLabel = makeUniqueBrushPresetLabel(scope === "blend" ? "New Blend" : "New Brush", this.getBrushPresets());
    const preset = buildBrushPresetFromBrush({
      ...sourcePreset,
      tool: scope === "blend" ? "blend" : "brush",
    }, {
      label: presetLabel,
      libraryGroup: "custom",
      sourcePreset,
    });
    if (!preset) {
      return;
    }
    this.upsertCustomBrushPreset(preset);
    this.engine.setBrushPreset(preset.id);
    this.openBrushEditor();
    this.setStatus(`New preset · ${preset.label}`);
  }

  saveActiveBrushPreset() {
    const presetScope = getPresetScopeForTool(this.engine?.brush?.tool);
    if (!presetScope) {
      return;
    }

    const activePreset = this.findBrushPreset();
    const isBuiltInPreset = !activePreset || isBuiltInBrushPresetId(activePreset.id);
    const targetLabel = isBuiltInPreset
      ? makeUniqueBrushPresetLabel(
        `${activePreset?.label || (presetScope === "blend" ? "Blend" : "Brush")} Custom`,
        this.getBrushPresets(),
      )
      : activePreset.label;
    const preset = this.createPresetFromActiveBrush({
      id: isBuiltInPreset ? undefined : activePreset.id,
      label: targetLabel,
      libraryGroup: activePreset?.libraryGroup || "custom",
      sourcePreset: activePreset,
    });
    if (!preset) {
      return;
    }
    this.upsertCustomBrushPreset(preset);
    this.engine.setBrushPreset(preset.id);
    this.setStatus(`Saved preset · ${preset.label}`);
  }

  saveActiveBrushPresetAsNew() {
    const presetScope = getPresetScopeForTool(this.engine?.brush?.tool);
    if (!presetScope) {
      return;
    }

    const activePreset = this.findBrushPreset();
    const duplicateLabel = makeUniqueBrushPresetLabel(
      `${activePreset?.label || (presetScope === "blend" ? "Blend" : "Brush")} Copy`,
      this.getBrushPresets(),
    );
    const preset = this.createPresetFromActiveBrush({
      label: duplicateLabel,
      libraryGroup: activePreset?.libraryGroup || "custom",
      sourcePreset: activePreset,
    });
    if (!preset) {
      return;
    }
    this.upsertCustomBrushPreset(preset);
    this.engine.setBrushPreset(preset.id);
    this.setStatus(`Duplicated preset · ${preset.label}`);
  }

  syncBrushPresetActions() {
    const presetScope = getPresetScopeForTool(this.engine?.brush?.tool);
    const showPresetActions = Boolean(presetScope);
    if (this.brushNewButton) {
      this.brushNewButton.hidden = !showPresetActions;
      this.brushNewButton.textContent = presetScope === "blend" ? "+ New Blend" : "+ New Brush";
    }
    if (this.brushEditorSaveButton) {
      this.brushEditorSaveButton.hidden = !showPresetActions;
    }
    if (this.brushEditorDuplicateButton) {
      this.brushEditorDuplicateButton.hidden = !showPresetActions;
    }
  }

  syncBrushPresentation(activePresetDefinition = this.findBrushPreset()) {
    const brush = this.engine?.brush;
    if (!brush) {
      return;
    }

    const activeToolLabel = TOOLS.find((tool) => tool.id === brush.tool)?.label || "Brush";
    const presetScope = getPresetScopeForTool(brush.tool);
    const strokeTool = isStrokeTool(brush.tool);
    const primaryTitle = presetScope ? (activePresetDefinition?.label || activeToolLabel) : activeToolLabel;
    const familyLabel = activePresetDefinition?.libraryGroup
      ? formatLibraryGroupLabel(activePresetDefinition.libraryGroup)
      : (presetScope ? "Preset" : "Direct Tool");
    const brushCopy = {
      fill: "Flood fill with threshold and layer sampling behavior from the active tool.",
      eyedropper: "Samples visible color from the canvas composite directly.",
      pan: "Moves around the canvas without changing the active paint settings.",
    }[brush.tool] || TOOL_DESCRIPTIONS[brush.tool] || "Tune the active brush and preview the result.";
    const sizeChip = strokeTool
      ? `${Math.round(Number(brush.size) || 0)} px`
      : (brush.tool === "fill" ? `Tol ${Math.round(brush.fillTolerance ?? 18)}` : activeToolLabel);
    const responseChip = brush.tool === "blend"
      ? `Smudge ${formatPercent(brush.smudgeStrength ?? 0.6)}`
      : (strokeTool
        ? `Flow ${formatPercent(brush.flow)}`
        : (brush.tool === "fill"
          ? (brush.sampleAllLayers !== false ? "Sample All" : "Sample Layer")
          : "Canvas Tool"));

    if (this.brushEditorSummaryTitle) {
      this.brushEditorSummaryTitle.textContent = primaryTitle;
    }
    if (this.brushEditorSummaryCopy) {
      this.brushEditorSummaryCopy.textContent = brushCopy;
    }
    if (this.brushEditorSummarySwatch) {
      this.brushEditorSummarySwatch.style.background = brush.color;
    }
    if (this.brushEditorSummaryToolPill) {
      this.brushEditorSummaryToolPill.textContent = activeToolLabel;
    }
    if (this.brushEditorSummaryFamilyPill) {
      this.brushEditorSummaryFamilyPill.textContent = familyLabel;
    }
    if (this.brushEditorSummarySizePill) {
      this.brushEditorSummarySizePill.textContent = sizeChip;
    }
    if (this.brushEditorSummaryResponsePill) {
      this.brushEditorSummaryResponsePill.textContent = responseChip;
    }
  }

  createBrushEditorControlField(definition) {
    let inputElement = null;
    if (definition.type === "range") {
      inputElement = slider(definition.min, definition.max, definition.step, definition.initial ?? 0);
    } else if (definition.type === "select") {
      inputElement = select(getBrushEditorControlOptions(definition, this.engine?.brush), definition.initial ?? "");
    } else if (definition.type === "textarea") {
      inputElement = document.createElement("textarea");
      inputElement.rows = definition.rows || 4;
      inputElement.value = String(definition.initial ?? "");
    } else {
      inputElement = textInput(String(definition.initial ?? ""));
    }

    inputElement.dataset.controlKey = definition.key;
    const valueElement = definition.type === "range" ? document.createElement("div") : null;
    const wrapper = valueElement
      ? this.#fieldWithValue(definition.label, inputElement, valueElement)
      : createField(definition.label, inputElement);
    wrapper.dataset.controlKey = definition.key;
    wrapper.classList.add("cp-brush-control");
    if (definition.type === "textarea") {
      wrapper.classList.add("cp-brush-control--textarea");
    }
    return {
      definition,
      wrapper,
      input: inputElement,
      valueElement,
    };
  }

  syncBrushEditorControlField(control, brush = this.engine?.brush) {
    if (!control || !brush) {
      return false;
    }
    const visible = isBrushEditorControlVisible(control.definition, brush);
    control.wrapper.hidden = !visible;
    if (!visible) {
      return false;
    }

    const value = getBrushEditorControlValue(control.definition, brush);
    if (control.input instanceof HTMLSelectElement) {
      const options = control.definition.key === "presetId"
        ? this.getScopedBrushPresets(brush.tool).map((preset) => ({
          value: preset.id,
          label: `${preset.label} · ${formatLibraryGroupLabel(preset.libraryGroup)}`,
        }))
        : getBrushEditorControlOptions(control.definition, brush);
      syncSelectOptions(control.input, options, value);
    } else {
      control.input.value = String(value ?? "");
    }
    if (control.valueElement) {
      control.valueElement.textContent = getBrushEditorControlDisplayValue(control.definition, value, brush);
    }
    return true;
  }

  commitBrushEditorControl(definition, rawValue) {
    if (!definition || !this.engine?.brush) {
      return;
    }
    if (definition.key === "presetId") {
      this.engine.setBrushPreset(String(rawValue));
      return;
    }
    this.engine.patchBrush(getBrushEditorControlPatch(definition, rawValue, this.engine.brush));
  }

  syncBrushControls() {
    const brush = this.engine.brush;
    this.recordColorHistory(brush.color);
    this.hexInput.value = brush.color;
    this.toolbarSizeInput.value = String(brush.size);
    this.toolbarOpacityInput.value = String(brush.opacity);
    this.toolbarSizeLabel.textContent = `${Math.round(Number(brush.size))}`;
    this.toolbarOpacityLabel.textContent = formatPercent(brush.opacity);
    const activeToolLabel = TOOLS.find((tool) => tool.id === brush.tool)?.label || "Brush";
    const presetScope = getPresetScopeForTool(brush.tool);
    const activePresetDefinition = this.findBrushPreset(brush.presetId);
    this.syncBrushPresentation(activePresetDefinition);
    this.brushReadout.textContent = presetScope
      ? `${(activePresetDefinition?.label || activeToolLabel)} · ${Math.round(brush.size)} px`
      : ({
        fill: `${activeToolLabel} · tol ${Math.round(brush.fillTolerance ?? 18)}`,
        eyedropper: `${activeToolLabel} · sample`,
        pan: `${activeToolLabel} · view`,
      }[brush.tool] || activeToolLabel);
    this.brushPanelButtonMeta.textContent = TOOL_DESCRIPTIONS[brush.tool] || "";
    this.colorPanelButtonSwatch.style.background = brush.color;
    this.colorWheel.setHex(brush.color, { silent: true });
    if (this.brushEditorOpen) {
      this.renderBrushPreview();
    }
    this.toolButtons.forEach((buttonElement) => {
      buttonElement.classList.toggle("cp-active", buttonElement.dataset.toolId === brush.tool);
    });
    this.presetButtons.forEach((buttonElement) => {
      buttonElement.classList.toggle("cp-active", buttonElement.dataset.presetId === brush.presetId);
    });
    this.previewWheelColor(brush.color);
    this.toolHint.textContent = TOOL_DESCRIPTIONS[brush.tool] || "";
    Object.values(this.brushControlRegistry || {}).forEach((control) => {
      this.syncBrushEditorControlField(control, brush);
    });
    this.syncBrushPresetActions();
    this.renderBrushLibrary();
    this.renderColorHistory();
    this.syncBrushEditorSections();
    this.refreshPanelVisibility();
  }

  syncSwatches() {
    [this.swatchButtons].forEach((group) => group.forEach((buttonElement) => {
      buttonElement.classList.toggle("cp-selected", buttonElement.dataset.color === this.engine.brush.color);
    }));
  }

  togglePanel(panelName, force) {
    if (!(panelName in this.panelState)) {
      return;
    }
    const nextState = typeof force === "boolean" ? force : !this.panelState[panelName];
    if (nextState) {
      this.panelState.interfaceHidden = false;
    }
    this.panelState[panelName] = nextState;
    if (panelName === "brushLibrary" && nextState) {
      this.renderBrushLibrary();
    }
    if (panelName === "color" && nextState) {
      this.renderColorHistory();
    }
    this.refreshPanelVisibility();
  }

  toggleSplitView(force) {
    const nextState = typeof force === "boolean" ? force : !this.splitViewEnabled;
    this.splitViewEnabled = nextState;
    this.root.classList.toggle("cp-split-view", nextState);
    this.streamPane.hidden = !nextState;
    if (this.streamPaneToolbar) {
      this.streamPaneToolbar.hidden = !nextState || this.panelState.interfaceHidden;
    }
    this.panelButtons.splitView?.classList.toggle("cp-active", nextState);
    if (nextState) {
      this.panelState.interfaceHidden = false;
      this.refreshIncomingStream();
      this.startIncomingStreamPolling();
    } else {
      void this.stopIncomingStreamAutoRun({ interrupt: false, silent: true });
      this.stopIncomingStreamPolling();
    }
    this.refreshPanelVisibility();
    this.refreshCanvasOverlay();
  }

  toggleInterfaceHidden(force) {
    const nextState = typeof force === "boolean" ? force : !this.panelState.interfaceHidden;
    this.panelState.interfaceHidden = nextState;
    this.refreshPanelVisibility();
    this.refreshCanvasOverlay();
  }

  startIncomingStreamPolling() {
    this.stopIncomingStreamPolling();
    if (!this.splitViewEnabled || !this.isOpen) {
      return;
    }
    this.streamRefreshTimer = window.setInterval(() => {
      this.refreshIncomingStream();
    }, 1200);
  }

  stopIncomingStreamPolling() {
    window.clearInterval(this.streamRefreshTimer);
    this.streamRefreshTimer = 0;
  }

  bindIncomingStreamRuntime() {
    if (this.streamRuntimeBound || typeof api?.addEventListener !== "function") {
      return;
    }
    this.handleIncomingStreamStatusEvent = this.handleIncomingStreamStatusEvent.bind(this);
    this.handleIncomingStreamExecutionStart = this.handleIncomingStreamExecutionStart.bind(this);
    this.handleIncomingStreamExecutionSuccess = this.handleIncomingStreamExecutionSuccess.bind(this);
    this.handleIncomingStreamExecutionError = this.handleIncomingStreamExecutionError.bind(this);
    this.handleIncomingStreamExecutionInterrupted = this.handleIncomingStreamExecutionInterrupted.bind(this);
    api.addEventListener("status", this.handleIncomingStreamStatusEvent);
    api.addEventListener("execution_start", this.handleIncomingStreamExecutionStart);
    api.addEventListener("execution_success", this.handleIncomingStreamExecutionSuccess);
    api.addEventListener("execution_error", this.handleIncomingStreamExecutionError);
    api.addEventListener("execution_interrupted", this.handleIncomingStreamExecutionInterrupted);
    this.streamRuntimeBound = true;
  }

  handleIncomingStreamStatusEvent(event) {
    const wasBusy = this.isIncomingStreamWorkflowBusy();
    this.streamQueueRemaining = Math.max(0, Number(event?.detail?.exec_info?.queue_remaining || 0));
    if (this.streamQueueRemaining > 0) {
      this.streamQueuePrimedUntil = 0;
    } else if (this.streamStopRequested && !this.streamActivePromptId) {
      this.streamStopRequested = false;
    }
    this.syncIncomingStreamControls();
    if (wasBusy && !this.isIncomingStreamWorkflowBusy() && this.splitViewEnabled && this.isOpen) {
      this.refreshIncomingStream();
    }
  }

  handleIncomingStreamExecutionStart(event) {
    this.streamActivePromptId = String(event?.detail?.prompt_id || "");
    this.streamQueueRequestPending = false;
    this.streamQueuePrimedUntil = 0;
    this.syncIncomingStreamControls();
  }

  handleIncomingStreamExecutionSuccess() {
    this.streamActivePromptId = "";
    this.streamStopRequested = false;
    this.syncIncomingStreamControls();
    if (this.splitViewEnabled && this.isOpen) {
      window.setTimeout(() => this.refreshIncomingStream(), 180);
    }
  }

  handleIncomingStreamExecutionError() {
    this.streamActivePromptId = "";
    this.streamStopRequested = false;
    this.syncIncomingStreamControls();
    if (this.splitViewEnabled && this.isOpen) {
      window.setTimeout(() => this.refreshIncomingStream(), 180);
    }
    this.setStatus("Background workflow failed");
  }

  handleIncomingStreamExecutionInterrupted() {
    this.streamActivePromptId = "";
    this.streamQueuePrimedUntil = 0;
    this.syncIncomingStreamControls();
    if (this.splitViewEnabled && this.isOpen) {
      window.setTimeout(() => this.refreshIncomingStream(), 120);
    }
    if (this.streamStopRequested) {
      this.setStatus("Stopped background workflow");
    }
    this.streamStopRequested = false;
  }

  isIncomingStreamWorkflowBusy() {
    return this.streamQueueRequestPending
      || this.streamQueueRemaining > 0
      || Date.now() < this.streamQueuePrimedUntil;
  }

  getIncomingStreamStatusMessage(stream = this.incomingStreamState) {
    const intervalLabel = `${this.streamAutoRunSeconds}s`;
    if (this.streamStopRequested) {
      return "Stopping background workflow...";
    }
    if (this.streamQueueRequestPending) {
      return this.streamAutoRunActive
        ? `Active run every ${intervalLabel} · queueing background workflow...`
        : "Queueing background workflow...";
    }
    if (this.streamQueueRemaining > 0) {
      return this.streamAutoRunActive
        ? `Active run every ${intervalLabel} · background workflow running.`
        : "Background workflow running.";
    }
    if (this.streamAutoRunActive) {
      return `Active run every ${intervalLabel} · waiting for the next cycle.`;
    }
    return stream?.status || "Pulled from the downstream receiver for this document.";
  }

  syncIncomingStreamControls(stream = this.incomingStreamState) {
    const canRunWorkflow = this.isOpen && typeof app?.queuePrompt === "function";
    const isBusy = this.isIncomingStreamWorkflowBusy();
    if (this.streamPaneStatus) {
      this.streamPaneStatus.textContent = this.getIncomingStreamStatusMessage(stream);
    }
    if (this.streamIntervalSelect) {
      this.streamIntervalSelect.value = String(this.streamAutoRunSeconds);
      this.streamIntervalSelect.disabled = !canRunWorkflow;
    }
    if (this.streamRefreshButton) {
      this.streamRefreshButton.disabled = !canRunWorkflow || isBusy;
    }
    if (this.streamAutoRunButton) {
      this.streamAutoRunButton.disabled = !canRunWorkflow;
      this.streamAutoRunButton.classList.toggle("cp-active", this.streamAutoRunActive);
    }
    if (this.streamStopButton) {
      this.streamStopButton.disabled = !this.streamAutoRunActive && !isBusy;
    }
    if (this.streamExportButton) {
      this.streamExportButton.disabled = !stream?.connected;
    }
  }

  async runBackgroundWorkflow({ reason = "manual", quietWhenBusy = false } = {}) {
    if (!this.isOpen || typeof app?.queuePrompt !== "function") {
      if (!quietWhenBusy) {
        this.setStatus("Background workflow unavailable");
      }
      this.syncIncomingStreamControls();
      return false;
    }
    if (this.isIncomingStreamWorkflowBusy()) {
      if (!quietWhenBusy) {
        this.setStatus("Background workflow already running");
      }
      this.syncIncomingStreamControls();
      return false;
    }

    try {
      if (this.savingPromise || this.needsSave) {
        if (!quietWhenBusy) {
          this.setStatus("Saving before background workflow");
        }
        await this.saveNow({ force: true });
      }
    } catch (error) {
      if (!quietWhenBusy) {
        const message = error instanceof Error ? error.message : "";
        this.setStatus(message ? `Background workflow save failed · ${message}` : "Background workflow save failed");
      }
      this.syncIncomingStreamControls();
      return false;
    }

    const currentRunToken = Number(getWidgetValue(this.node, "run_token", 0) || 0);
    setWidgetValue(this.node, "run_token", currentRunToken + 1);

    this.streamStopRequested = false;
    this.streamQueueRequestPending = true;
    this.streamQueuePrimedUntil = Date.now() + 2500;
    this.syncIncomingStreamControls();

    try {
      const queued = await app.queuePrompt(0, 1);
      if (!queued && !quietWhenBusy) {
        this.setStatus("Background workflow not queued");
      } else if (reason === "manual") {
        this.setStatus("Queued background workflow");
      }
      if (this.splitViewEnabled) {
        this.refreshIncomingStream();
      }
      return Boolean(queued);
    } catch (error) {
      this.streamQueuePrimedUntil = 0;
      if (!quietWhenBusy) {
        const message = error instanceof Error ? error.message : "";
        this.setStatus(message ? `Background workflow failed · ${message}` : "Background workflow failed");
      }
      return false;
    } finally {
      this.streamQueueRequestPending = false;
      this.syncIncomingStreamControls();
    }
  }

  startIncomingStreamAutoRun({ intervalSeconds = this.streamAutoRunSeconds, runImmediately = true } = {}) {
    const nextSeconds = [3, 5, 10].includes(Number(intervalSeconds)) ? Number(intervalSeconds) : 5;
    this.streamAutoRunSeconds = nextSeconds;
    window.clearInterval(this.streamAutoRunTimer);
    this.streamAutoRunTimer = 0;
    this.streamAutoRunActive = true;
    this.streamAutoRunTimer = window.setInterval(() => {
      this.runBackgroundWorkflow({ reason: "autorun", quietWhenBusy: true }).catch(() => {});
    }, nextSeconds * 1000);
    this.syncIncomingStreamControls();
    this.setStatus(`Active run · every ${nextSeconds}s`);
    if (runImmediately) {
      this.runBackgroundWorkflow({ reason: "autorun", quietWhenBusy: true }).catch(() => {});
    }
  }

  async stopIncomingStreamAutoRun({ interrupt = true, silent = false } = {}) {
    const wasAutoRunActive = this.streamAutoRunActive;
    window.clearInterval(this.streamAutoRunTimer);
    this.streamAutoRunTimer = 0;
    this.streamAutoRunActive = false;
    this.syncIncomingStreamControls();

    const shouldInterrupt = interrupt && (
      this.streamQueueRequestPending
      || this.streamQueueRemaining > 0
      || Boolean(this.streamActivePromptId)
    );
    if (shouldInterrupt && typeof api?.interrupt === "function") {
      this.streamStopRequested = true;
      this.syncIncomingStreamControls();
      try {
        await api.interrupt(this.streamActivePromptId || null);
        if (!silent) {
          this.setStatus("Stopping background workflow...");
        }
      } catch (error) {
        this.streamStopRequested = false;
        this.syncIncomingStreamControls();
        if (!silent) {
          const message = error instanceof Error ? error.message : "";
          this.setStatus(message ? `Stop failed · ${message}` : "Stop failed");
        }
      }
      return;
    }

    this.streamStopRequested = false;
    this.syncIncomingStreamControls();
    if (!silent) {
      this.setStatus(wasAutoRunActive ? "Stopped active run" : "Nothing to stop");
    }
  }

  refreshPanelVisibility() {
    const interfaceHidden = this.panelState.interfaceHidden;
    const panelStateMap = {
      brushLibrary: this.brushLibraryPanel,
      layers: this.layersPanel,
      color: this.colorPanel,
      document: this.documentPanel,
    };

    this.root.classList.toggle("cp-interface-hidden", interfaceHidden);
    this.streamPane.classList.toggle("cp-stream-pane--visible", this.splitViewEnabled && !interfaceHidden);
    if (this.streamPaneToolbar) {
      this.streamPaneToolbar.hidden = !this.splitViewEnabled || interfaceHidden;
    }

    Object.entries(panelStateMap).forEach(([panelName, panelElement]) => {
      if (!panelElement) {
        return;
      }
      const visible = !interfaceHidden && Boolean(this.panelState[panelName]);
      panelElement.hidden = !visible;
      panelElement.classList.toggle("cp-active", visible);
      this.panelButtons[panelName]?.classList.toggle("cp-active", visible);
      if (visible) {
        this.syncDefaultPanelPosition(panelName);
      }
    });

    this.panelButtons.guides?.classList.toggle("cp-active", this.showCanvasGuides);
    if (this.interfaceToggleButton) {
      this.interfaceToggleButton.classList.toggle("cp-active", !interfaceHidden);
      this.interfaceToggleButton.textContent = interfaceHidden ? "Show UI" : "Hide UI";
    }
    this.inspector.classList.toggle(
      "cp-inspector--empty",
      Object.keys(panelStateMap).every((panelName) => !this.panelState[panelName] || interfaceHidden),
    );

    if (this.syncSplitStageReserve() && this.isOpen) {
      this.engine.render();
    }
  }

  refreshIncomingStream() {
    const stream = this.resolveIncomingStreamSource(this.incomingStreamState);
    this.incomingStreamState = stream;
    this.layoutSplitArtboard();
    this.streamPaneTitle.textContent = stream.sourceTitle || "Downstream Preview";
    this.syncIncomingStreamControls(stream);
    this.streamPaneEmpty.hidden = true;
    this.streamPaneCanvas.hidden = false;
    this.streamPaneEmpty.textContent = "";

    if (!stream.connected) {
      this.drawIncomingStreamPlaceholder(stream);
      return;
    }

    this.drawIncomingStreamPreview(stream).catch(() => {
      if (stream.previewImage instanceof HTMLImageElement && stream.previewImage.naturalWidth) {
        this.redrawIncomingStreamArtboard();
        return;
      }
      this.drawIncomingStreamPlaceholder({
        ...stream,
        status: "Run the receiver node to update this preview.",
      });
    });
  }

  resolveIncomingStreamSource(previousStream = this.incomingStreamState) {
    const documentId = String(this.engine?.document?.id || getWidgetValue(this.node, "document_id", "") || "").trim();
    const previewKey = String(this.engine?.document?.previewKey || "").trim();
    const studioNodeKey = this.node?.id ? `studio-node-${this.node.id}` : "";
    const previewKeys = [documentId, previewKey, studioNodeKey].filter((value, index, values) => value && values.indexOf(value) === index);
    if (!previewKeys.length) {
      return {
        connected: false,
        sourceNodeId: 0,
        sourceTitle: "Downstream Preview",
        previewKey: "",
        previewUrls: [],
        previewUrl: "",
        status: "Open the studio once to initialize the preview link.",
      };
    }
    const timestamp = Date.now();
    const previewUrls = previewKeys.map((key) => {
      const previewPath = `${API_PREFIX}/documents/${encodeURIComponent(key)}/split-preview.png?ts=${timestamp}`;
      return typeof api?.apiURL === "function" ? api.apiURL(previewPath) : previewPath;
    });
    const previewImage = previousStream?.previewKey === previewKeys[0]
      ? previousStream.previewImage || null
      : null;

    return {
      connected: true,
      sourceNodeId: 0,
      sourceTitle: "Downstream Preview",
      previewKey: previewKeys[0],
      previewUrls,
      previewUrl: previewUrls[0],
      previewImage,
      status: "Pulled from the downstream receiver for this document.",
    };
  }

  getIncomingStreamCanvasMetrics() {
    const canvas = this.streamPaneCanvas;
    const bounds = this.streamPaneSurface?.getBoundingClientRect() || this.streamPane.getBoundingClientRect();
    const width = Math.max(24, Math.round(bounds.width - 4));
    const height = Math.max(24, Math.round(bounds.height - 4));
    return { canvas, width, height };
  }

  ensureIncomingStreamCanvasSize(canvas, width, height) {
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    const widthPx = `${width}px`;
    const heightPx = `${height}px`;
    if (canvas.style.width !== widthPx) {
      canvas.style.width = widthPx;
    }
    if (canvas.style.height !== heightPx) {
      canvas.style.height = heightPx;
    }
  }

  async drawIncomingStreamPreview(stream) {
    const { canvas, width, height } = this.getIncomingStreamCanvasMetrics();
    const ctx = canvas.getContext("2d");
    const existingImage = stream.previewImage instanceof HTMLImageElement && stream.previewImage.naturalWidth
      ? stream.previewImage
      : null;
    if (existingImage) {
      this.ensureIncomingStreamCanvasSize(canvas, width, height);
      this.drawIncomingStreamArtboard(ctx, width, height, {
        image: existingImage,
        status: this.getIncomingStreamStatusMessage(stream),
        title: stream.sourceTitle || "Downstream Preview",
      });
    }

    const requestId = ++this.streamPreviewRequestId;
    const previewUrls = Array.isArray(stream.previewUrls) && stream.previewUrls.length
      ? stream.previewUrls
      : [stream.previewUrl].filter(Boolean);
    let image = existingImage;
    let loadedPreviewUrl = stream.previewUrl;
    let lastError = null;
    for (const previewUrl of previewUrls) {
      try {
        image = await new Promise((resolve, reject) => {
          const nextImage = new Image();
          nextImage.onload = () => resolve(nextImage);
          nextImage.onerror = () => reject(new Error("Failed to load preview image."));
          nextImage.src = previewUrl;
        });
        loadedPreviewUrl = previewUrl;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) {
      if (existingImage) {
        return;
      }
      throw lastError || new Error("Failed to load preview image.");
    }
    if (requestId !== this.streamPreviewRequestId) {
      return;
    }
    this.ensureIncomingStreamCanvasSize(canvas, width, height);
    this.incomingStreamState.previewImage = image;
    this.incomingStreamState.previewUrl = loadedPreviewUrl;

    this.drawIncomingStreamArtboard(ctx, width, height, {
      image,
      status: this.getIncomingStreamStatusMessage(stream),
      title: stream.sourceTitle || "Downstream Preview",
    });
  }

  drawIncomingStreamPlaceholder(stream) {
    const { canvas, width, height } = this.getIncomingStreamCanvasMetrics();
    const ctx = canvas.getContext("2d");
    this.ensureIncomingStreamCanvasSize(canvas, width, height);
    this.incomingStreamState.previewImage = null;

    this.drawIncomingStreamArtboard(ctx, width, height, {
      image: null,
      status: this.getIncomingStreamStatusMessage(stream),
      title: stream.sourceTitle || "Downstream Preview",
    });
  }

  redrawIncomingStreamArtboard() {
    if (!this.splitViewEnabled || !this.streamPane || this.streamPane.hidden) {
      return;
    }
    const stream = this.incomingStreamState || {};
    this.syncIncomingStreamControls(stream);
    if (stream.connected && stream.previewImage instanceof HTMLImageElement && stream.previewImage.naturalWidth) {
      const { canvas, width, height } = this.getIncomingStreamCanvasMetrics();
      const ctx = canvas.getContext("2d");
      this.ensureIncomingStreamCanvasSize(canvas, width, height);
      this.drawIncomingStreamArtboard(ctx, width, height, {
        image: stream.previewImage,
        status: this.getIncomingStreamStatusMessage(stream),
        title: stream.sourceTitle || "Downstream Preview",
      });
      return;
    }
    this.drawIncomingStreamPlaceholder(stream);
  }

  drawIncomingStreamArtboard(ctx, width, height, { image = null, status = "", title = "Preview Artboard" } = {}) {
    ctx.clearRect(0, 0, width, height);
    const document = this.engine.document;
    const artboardWidth = document?.width || image?.naturalWidth || 1024;
    const artboardHeight = document?.height || image?.naturalHeight || 1024;
    const insetX = 18;
    const insetTop = 18;
    const insetBottom = 18;
    const scale = Math.min(
      (width - (insetX * 2)) / Math.max(1, artboardWidth),
      (height - insetTop - insetBottom) / Math.max(1, artboardHeight),
    );
    const drawWidth = Math.max(1, Math.round(artboardWidth * scale));
    const drawHeight = Math.max(1, Math.round(artboardHeight * scale));
    const drawX = Math.round((width - drawWidth) / 2);
    const drawY = Math.round(insetTop + ((height - insetTop - insetBottom - drawHeight) / 2));

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = document?.background?.mode === "solid"
      ? `${document.background.color || "#f3efe5"}`
      : "rgba(246, 242, 233, 0.96)";
    roundedRectPath(ctx, drawX, drawY, drawWidth, drawHeight, 24);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, drawX, drawY, drawWidth, drawHeight, 24);
    ctx.clip();
    if (document?.background?.mode === "solid") {
      ctx.fillStyle = document.background.color || "#f3efe5";
      ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
    } else {
      const tile = Math.max(10, Math.round(14 * scale));
      for (let row = 0; row < drawHeight / tile + 1; row += 1) {
        for (let column = 0; column < drawWidth / tile + 1; column += 1) {
          ctx.fillStyle = (row + column) % 2 === 0 ? "#e9e1d4" : "#f6f0e7";
          ctx.fillRect(drawX + column * tile, drawY + row * tile, tile, tile);
        }
      }
    }
    const paperGradient = ctx.createLinearGradient(drawX, drawY, drawX, drawY + drawHeight);
    paperGradient.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    paperGradient.addColorStop(1, "rgba(0, 0, 0, 0.05)");
    ctx.fillStyle = paperGradient;
    ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
    if (image) {
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    } else {
      const inset = Math.max(18, Math.round(drawWidth * 0.08));
      const compactArtboard = drawWidth < 300;
      const titleMaxWidth = Math.max(72, drawWidth - (inset * 2) - 12);
      const titleFontSize = compactArtboard ? 16 : 18;
      const bodyFontSize = compactArtboard ? 11 : 13;
      const titleLineHeight = titleFontSize + 4;
      const bodyLineHeight = bodyFontSize + 5;
      const titleLines = (() => {
        ctx.font = `700 ${titleFontSize}px "SF Pro Display", "Avenir Next", sans-serif`;
        return wrapCanvasText(ctx, title, titleMaxWidth, compactArtboard ? 2 : 1);
      })();
      const statusLines = (() => {
        ctx.font = `600 ${bodyFontSize}px "SF Pro Display", "Avenir Next", sans-serif`;
        const fallback = compactArtboard
          ? "Run receiver to update preview."
          : "Processed preview appears here.";
        return wrapCanvasText(ctx, status || fallback, titleMaxWidth, compactArtboard ? 3 : 2);
      })();
      const textHeight = (titleLines.length * titleLineHeight) + (statusLines.length ? 6 + (statusLines.length * bodyLineHeight) : 0);
      let lineY = drawY + (drawHeight / 2) - (textHeight / 2) + titleFontSize;

      ctx.strokeStyle = "rgba(20, 24, 30, 0.14)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      roundedRectPath(
        ctx,
        drawX + inset,
        drawY + inset,
        Math.max(24, drawWidth - (inset * 2)),
        Math.max(24, drawHeight - (inset * 2)),
        18,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(19, 23, 30, 0.64)";
      ctx.font = `700 ${titleFontSize}px "SF Pro Display", "Avenir Next", sans-serif`;
      titleLines.forEach((line) => {
        ctx.fillText(line, drawX + (drawWidth / 2), lineY, titleMaxWidth);
        lineY += titleLineHeight;
      });
      ctx.fillStyle = "rgba(19, 23, 30, 0.42)";
      ctx.font = `600 ${bodyFontSize}px "SF Pro Display", "Avenir Next", sans-serif`;
      lineY += 6;
      statusLines.forEach((line) => {
        ctx.fillText(line, drawX + (drawWidth / 2), lineY, titleMaxWidth);
        lineY += bodyLineHeight;
      });
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    roundedRectPath(ctx, drawX + 0.5, drawY + 0.5, Math.max(0, drawWidth - 1), Math.max(0, drawHeight - 1), 24);
    ctx.stroke();
  }

  layoutSplitArtboard() {
    if (!this.streamPane || !this.streamPaneSurface || !this.engine.document || !this.splitViewEnabled || this.panelState.interfaceHidden) {
      return;
    }

    const layout = computeSplitArtboardLayout({
      document: this.engine.document,
      stageWidth: this.stage.clientWidth,
      stageHeight: this.stage.clientHeight,
    });
    if (!layout) {
      return;
    }

    this.streamPane.style.left = `${layout.left}px`;
    this.streamPane.style.top = `${layout.top}px`;
    this.streamPane.style.width = `${layout.width}px`;
    this.streamPane.style.height = `${layout.height}px`;
    this.streamPaneSurface.style.height = `${layout.boardHeight}px`;
    this.streamPane.classList.toggle("cp-stage__split-board--compact", layout.compact);
    this.streamPane.classList.toggle("cp-stage__split-board--micro", layout.micro);
    this.streamPaneToolbar?.classList.toggle("cp-stage__split-toolbar--compact", layout.compact);
    this.streamPaneToolbar?.classList.toggle("cp-stage__split-toolbar--micro", layout.micro);
    this.streamPane.dataset.side = layout.side;
  }

  async exportIncomingStreamToCanvas() {
    const stream = this.incomingStreamState;
    if (!stream?.connected || !stream.previewUrl) {
      return;
    }

    if (this.streamExportButton) {
      this.streamExportButton.disabled = true;
    }
    try {
      const response = await fetch(stream.previewUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Preview request failed: ${response.status}`);
      }
      const blob = await response.blob();
      await this.engine.importBlob(blob, {
        name: "Downstream Preview",
        actionLabel: "Import Downstream Preview",
      });
      this.setStatus("Imported downstream preview");
    } catch {
      this.setStatus("Downstream import failed");
    } finally {
      if (this.streamExportButton) {
        this.streamExportButton.disabled = !stream.connected;
      }
    }
  }

  recordColorHistory(color) {
    const normalized = String(color || "").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      return;
    }

    if (this.lastSyncedBrushColor && this.lastSyncedBrushColor !== normalized) {
      this.previousColor = this.lastSyncedBrushColor;
    } else if (!this.lastSyncedBrushColor) {
      this.previousColor = normalized;
    }

    this.lastSyncedBrushColor = normalized;
    this.colorHistory = [normalized, ...this.colorHistory.filter((item) => item !== normalized)].slice(0, 12);
  }

  previewWheelColor(hex) {
    const normalized = String(hex || "").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      return;
    }
    this.hexInput.value = normalized;
    this.colorPreview.style.background = normalized;
    this.colorPanelButtonSwatch.style.background = normalized;
  }

  renderColorHistory() {
    if (!this.colorHistoryButtons) {
      return;
    }

    this.previousColorPreview.style.background = this.previousColor;
    this.colorHistoryButtons.forEach((buttonElement, index) => {
      const color = this.colorHistory[index];
      buttonElement.hidden = !color;
      if (!color) {
        return;
      }
      buttonElement.dataset.color = color;
      buttonElement.style.background = color;
      buttonElement.classList.toggle("cp-selected", color === this.engine.brush.color);
    });
  }

  setBrushTool(toolId) {
    const presetScope = getPresetScopeForTool(toolId);
    const currentPreset = this.findBrushPreset(this.engine.brush.presetId);

    if (!presetScope) {
      this.engine.patchBrush({ tool: toolId });
      this.syncBrushControls();
      return;
    }

    const nextPreset = currentPreset?.tool === presetScope
      ? currentPreset
      : this.getScopedBrushPresets(toolId)[0] || currentPreset;

    const nextPatch = nextPreset
      ? {
        ...nextPreset,
        presetId: nextPreset.id,
        tool: toolId,
      }
      : { tool: toolId };

    this.engine.patchBrush(nextPatch);
    this.syncBrushControls();
  }

  setPanelPosition(panelName, left, top, { relativeToShell = false } = {}) {
    const panel = this.panelRegistry?.[panelName]?.panel;
    if (!panel) {
      return;
    }

    const shellBounds = getShellBounds(this.inspector);
    const width = panel.offsetWidth || panel.getBoundingClientRect().width || 280;
    const height = panel.offsetHeight || panel.getBoundingClientRect().height || 220;
    const localLeft = relativeToShell ? left : left - shellBounds.left;
    const localTop = relativeToShell ? top : top - shellBounds.top;
    const nextPosition = clampFreePanelPosition({
      left: localLeft,
      top: localTop,
      width,
      height,
      shellBounds,
    });
    this.panelPositions[panelName] = nextPosition;
    panel.style.left = `${nextPosition.left}px`;
    panel.style.top = `${nextPosition.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.classList.add("cp-panel--free");
  }

  resetPanelPosition(panelName) {
    const panel = this.panelRegistry?.[panelName]?.panel;
    if (!panel) {
      return;
    }
    delete this.panelPositions[panelName];
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
    panel.classList.remove("cp-panel--free");
    this.syncDefaultPanelPosition(panelName);
  }

  syncPanelPosition(panelName) {
    const position = this.panelPositions[panelName];
    if (!position) {
      return;
    }
    this.setPanelPosition(panelName, position.left, position.top, { relativeToShell: true });
  }

  syncDefaultPanelPosition(panelName) {
    if (this.panelPositions[panelName]) {
      return;
    }
    const panel = this.panelRegistry?.[panelName]?.panel;
    if (!panel || panel.hidden) {
      return;
    }
    const nextPosition = resolveAnchoredPanelPosition({
      panelName,
      panel,
      panelButtons: this.panelButtons,
      shellBounds: getShellBounds(this.inspector),
    });
    if (!nextPosition) {
      return;
    }
    panel.style.left = `${nextPosition.left}px`;
    panel.style.top = `${nextPosition.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.classList.remove("cp-panel--free");
  }

  getAvailableBrushEditorSections(brush = this.engine?.brush) {
    return getBrushEditorSectionsForBrush(brush).map((section) => section.id);
  }

  syncBrushEditorSections() {
    const availableSections = this.getAvailableBrushEditorSections();
    if (!availableSections.includes(this.brushEditorSection)) {
      [this.brushEditorSection] = availableSections;
    }

    (this.brushEditorSectionButtons || []).forEach((buttonElement) => {
      const visible = availableSections.includes(buttonElement.dataset.section);
      buttonElement.hidden = !visible;
      buttonElement.classList.toggle("cp-active", visible && buttonElement.dataset.section === this.brushEditorSection);
    });

    if (this.assistEmptyState) {
      const tool = this.engine?.brush?.tool;
      const emptyCopy = getBrushEditorAssistMessage(tool);
      this.assistEmptyState.hidden = !emptyCopy;
      this.assistEmptyState.textContent = emptyCopy;
    }

    if (this.brushEditorOpen) {
      this.setBrushEditorSection(this.brushEditorSection);
      return;
    }

    Object.entries(this.brushEditorSections || {}).forEach(([name, section]) => {
      section.hidden = name !== this.brushEditorSection || !availableSections.includes(name);
    });
  }

  renderBrushLibrary() {
    if (!this.brushLibraryList || !this.brushLibraryEmptyState) {
      return;
    }

    const activeTool = this.engine.brush.tool;
    const presetScope = getPresetScopeForTool(activeTool);
    const activePreset = this.findBrushPreset(this.engine.brush.presetId) || this.getBrushPresets()[0] || BRUSH_PRESETS[0];
    const activeToolLabel = TOOLS.find((tool) => tool.id === activeTool)?.label || "Tool";
    const directToolCopy = {
      fill: "Fill uses threshold and sampling controls in Brush Tuning.",
      eyedropper: "Pick samples color from the visible canvas. No preset rows are needed here.",
      pan: "Pan moves around the canvas. Switch back to Brush, Erase, or Blend to browse presets.",
    }[activeTool] || "";

    if (!presetScope) {
      this.brushLibrarySubtitle.textContent = `${activeToolLabel} · direct canvas tool`;
      this.brushLibraryList.hidden = true;
      this.brushLibraryEmptyState.hidden = false;
      this.brushLibraryEmptyState.textContent = directToolCopy;
      return;
    }

    const scopedPresets = this.getScopedBrushPresets(activeTool);
    const subtitleLabel = activePreset.tool === presetScope
      ? activePreset.label
      : (scopedPresets[0]?.label || activeToolLabel);
    this.brushLibrarySubtitle.textContent = `${subtitleLabel} · ${Math.round(this.engine.brush.size)} px · ${scopedPresets.length} preset${scopedPresets.length === 1 ? "" : "s"}`;
    const hasVisiblePresets = scopedPresets.length > 0;
    if (!hasVisiblePresets) {
      this.brushLibraryList.replaceChildren();
      this.brushLibraryList.hidden = true;
      this.brushLibraryEmptyState.hidden = false;
      this.brushLibraryEmptyState.textContent = "No presets found for the active tool.";
      return;
    }

    const previousScrollTop = this.brushLibraryList.scrollTop;
    const fragment = document.createDocumentFragment();
    scopedPresets.forEach((preset) => {
      const buttonElement = document.createElement("button");
      buttonElement.type = "button";
      buttonElement.className = "cp-brush-library__preset";
      buttonElement.dataset.presetId = preset.id;
      buttonElement.classList.toggle("cp-active", preset.id === this.engine.brush.presetId);
      buttonElement.setAttribute("aria-label", preset.label);

      const preview = document.createElement("canvas");
      preview.className = "cp-brush-library__preview";

      const name = document.createElement("div");
      name.className = "cp-brush-library__name";
      name.textContent = preset.label;

      buttonElement.append(preview, name);
      buttonElement.addEventListener("click", () => {
        this.engine.setBrushPreset(preset.id);
      });
      buttonElement.addEventListener("dblclick", () => {
        this.engine.setBrushPreset(preset.id);
        this.openBrushEditor();
      });

      const previewBrush = preset.id === this.engine.brush.presetId
        ? {
          ...this.engine.brush,
          color: "#f4f6fb",
          tool: activeTool === "eraser" ? "brush" : this.engine.brush.tool,
        }
        : {
          ...preset,
          color: "#f4f6fb",
          tool: activeTool === "eraser" && preset.tool === "brush" ? "brush" : preset.tool,
        };
      const previewWidth = Math.max(
        340,
        Math.round((this.brushLibraryList?.clientWidth || this.brushLibraryPanel?.clientWidth || 372) - 8),
      );
      renderBrushStrokeSample(preview, previewBrush, {
        width: previewWidth,
        height: 176,
        background: "#171b22",
        sampleColor: "#f4f6fb",
        compact: true,
      });
      fragment.appendChild(buttonElement);
    });

    this.brushLibraryList.replaceChildren(fragment);
    this.brushLibraryList.scrollTop = previousScrollTop;
    this.brushLibraryList.hidden = false;
    this.brushLibraryEmptyState.hidden = true;
    this.brushLibraryEmptyState.textContent = "";
  }

  renderLayerList() {
    const currentDocument = this.engine.document;
    if (!currentDocument) {
      return;
    }
    const hasSoloPreview = this.engine.hasSoloLayer();
    const activeLayerId = currentDocument.activeLayerId;
    this.layersList.replaceChildren();
    [...currentDocument.layers].reverse().forEach((layer) => {
      const layerIndex = currentDocument.layers.findIndex((item) => item.id === layer.id);
      const isSolo = this.engine.isLayerSolo(layer.id);
      const isActive = layer.id === activeLayerId;
      const row = document.createElement("div");
      row.className = "cp-layer";
      row.classList.toggle("cp-active", isActive);
      row.classList.toggle("cp-layer--expanded", isActive);
      row.classList.toggle("cp-layer--hidden", !layer.visible);
      row.classList.toggle("cp-layer--locked", Boolean(layer.locked));
      row.classList.toggle("cp-layer--solo", isSolo);
      row.classList.toggle("cp-layer--muted", hasSoloPreview && !isSolo);
      row.addEventListener("click", () => {
        this.engine.setActiveLayer(layer.id);
        this.renderLayerList();
      });

      const thumbFrame = document.createElement("div");
      thumbFrame.className = "cp-layer__thumb";
      const thumb = document.createElement("canvas");
      thumb.width = 64;
      thumb.height = 64;
      thumb.getContext("2d").drawImage(layer.canvas, 0, 0, 64, 64);
      thumbFrame.appendChild(thumb);

      const layerState = document.createElement("div");
      layerState.className = "cp-layer__state";
      layerState.textContent = !layer.visible ? "off" : (layer.locked ? "lock" : "on");
      thumbFrame.appendChild(layerState);

      const body = document.createElement("div");
      body.className = "cp-layer__body";

      const titleRow = document.createElement("div");
      titleRow.className = "cp-layer__title-row";

      let titleControl = null;
      if (isActive) {
        const nameInput = textInput(layer.name);
        nameInput.className = "cp-layer__name";
        nameInput.addEventListener("click", (event) => event.stopPropagation());
        nameInput.addEventListener("change", () => {
          this.engine.updateLayerProperty(layer.id, "name", nameInput.value || layer.name);
        });
        titleControl = nameInput;
      } else {
        const nameLabel = document.createElement("div");
        nameLabel.className = "cp-layer__name-label";
        nameLabel.textContent = layer.name;
        titleControl = nameLabel;
      }

      const visibilityToggle = button(layer.visible ? "On" : "Off", "cp-layer__toggle cp-layer__toggle--compact");
      visibilityToggle.classList.toggle("cp-active", layer.visible);
      visibilityToggle.title = "Toggle visibility";
      visibilityToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.updateLayerProperty(layer.id, "visible", !layer.visible);
      });
      titleRow.append(titleControl, visibilityToggle);

      const badges = document.createElement("div");
      badges.className = "cp-layer__badges";
      if (layer.locked) {
        badges.appendChild(layerBadge("Locked"));
      }
      if (layer.alphaLocked) {
        badges.appendChild(layerBadge("Alpha", "cp-layer__badge--accent"));
      }
      if (!layer.visible) {
        badges.appendChild(layerBadge("Hidden"));
      }
      if (isSolo) {
        badges.appendChild(layerBadge("Solo", "cp-layer__badge--accent"));
      }

      const toggleRow = document.createElement("div");
      toggleRow.className = "cp-layer__row cp-layer__row--toggles";

      const lockToggle = button("Lock", "cp-layer__toggle");
      lockToggle.classList.toggle("cp-active", Boolean(layer.locked));
      lockToggle.title = "Prevent paint edits";
      lockToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.updateLayerProperty(layer.id, "locked", !layer.locked);
      });

      const alphaToggle = button("Alpha", "cp-layer__toggle");
      alphaToggle.classList.toggle("cp-active", Boolean(layer.alphaLocked));
      alphaToggle.title = "Preserve transparency while painting";
      alphaToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.updateLayerProperty(layer.id, "alphaLocked", !layer.alphaLocked);
      });

      const soloToggle = button("Solo", "cp-layer__toggle");
      soloToggle.classList.toggle("cp-active", isSolo);
      soloToggle.title = "Preview this layer by itself";
      soloToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.toggleSoloLayer(layer.id);
      });

      toggleRow.append(visibilityToggle, lockToggle, alphaToggle, soloToggle);

      const controlsRow = document.createElement("div");
      controlsRow.className = "cp-layer__mix";
      const opacityInput = slider(0, 1, 0.01, layer.opacity ?? 1);
      opacityInput.addEventListener("click", (event) => event.stopPropagation());
      opacityInput.addEventListener("change", (event) => {
        event.stopPropagation();
        this.engine.updateLayerProperty(layer.id, "opacity", Number(opacityInput.value));
      });

      const blendSelect = select(BLEND_MODES, layer.blendMode || "normal");
      blendSelect.addEventListener("click", (event) => event.stopPropagation());
      blendSelect.addEventListener("change", (event) => {
        event.stopPropagation();
        this.engine.updateLayerProperty(layer.id, "blendMode", blendSelect.value);
      });

      controlsRow.append(opacityInput, blendSelect);

      const meta = document.createElement("div");
      meta.className = "cp-layer__meta";
      meta.textContent = `${formatPercent(layer.opacity ?? 1)} · ${BLEND_MODES.find((item) => item.value === (layer.blendMode || "normal"))?.label || "Normal"}`;

      body.append(titleRow, badges, meta);

      if (isActive) {
        body.append(toggleRow, controlsRow);
      }

      const actions = document.createElement("div");
      actions.className = "cp-layer__actions";

      const duplicateButton = button("Copy", "cp-layer__action");
      duplicateButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.duplicateActiveLayer();
      });

      const clearButton = button("Clear", "cp-layer__action");
      clearButton.disabled = layer.locked;
      clearButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.clearActiveLayer();
      });

      const upButton = button("Up", "cp-layer__action");
      upButton.disabled = layerIndex >= currentDocument.layers.length - 1;
      upButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.moveActiveLayer(1);
      });

      const downButton = button("Down", "cp-layer__action");
      downButton.disabled = layerIndex <= 0;
      downButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.moveActiveLayer(-1);
      });

      const mergeButton = button("Merge", "cp-layer__action");
      mergeButton.disabled = layerIndex <= 0 || layer.locked || Boolean(currentDocument.layers[layerIndex - 1]?.locked);
      mergeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.mergeActiveLayerDown();
      });

      const deleteButton = button("Delete", "cp-layer__action cp-layer__action--danger");
      deleteButton.disabled = currentDocument.layers.length <= 1;
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.engine.setActiveLayer(layer.id);
        this.engine.deleteActiveLayer();
      });

      if (isActive) {
        actions.append(duplicateButton, clearButton, upButton, downButton, mergeButton, deleteButton);
      }
      row.append(thumbFrame, body);
      if (isActive) {
        row.append(actions);
      }
      this.layersList.appendChild(row);
    });
  }

  setStatus(text) {
    this.statusBadge.textContent = text;
  }

  openBrushEditor() {
    this.brushEditorOpen = true;
    this.brushEditorOverlay.hidden = false;
    this.root.classList.add("cp-brush-editor-open");
    this.syncBrushEditorSections();
    this.setBrushEditorSection(this.brushEditorSection || "stroke");
    this.resetBrushPreviewPad({ force: true });
    this.renderBrushPreview();
  }

  closeBrushEditor() {
    this.brushEditorOpen = false;
    this.brushEditorOverlay.hidden = true;
    this.root.classList.remove("cp-brush-editor-open");
    this.brushPreviewStroke = null;
  }

  setBrushEditorSection(sectionName) {
    const availableSections = this.getAvailableBrushEditorSections();
    const targetSection = availableSections.includes(sectionName) ? sectionName : availableSections[0];
    if (!targetSection || !(targetSection in (this.brushEditorSections || {}))) {
      return;
    }
    this.brushEditorSection = targetSection;
    const sectionCopy = getBrushEditorSectionMeta(targetSection, this.engine?.brush);
    if (this.brushEditorSectionTitleLabel) {
      this.brushEditorSectionTitleLabel.textContent = sectionCopy?.title || "Settings";
    }
    if (this.brushEditorSectionHintLabel) {
      this.brushEditorSectionHintLabel.textContent = sectionCopy?.description || "";
    }
    Object.entries(this.brushEditorSections).forEach(([name, section]) => {
      section.hidden = name !== targetSection || !availableSections.includes(name);
    });
    (this.brushEditorSectionButtons || []).forEach((buttonElement) => {
      buttonElement.hidden = !availableSections.includes(buttonElement.dataset.section);
      buttonElement.classList.toggle("cp-active", buttonElement.dataset.section === targetSection);
    });
  }

  getBrushPreviewPadPoint(event) {
    if (!this.brushPadCanvas) {
      return null;
    }
    const rect = this.brushPadCanvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
      return null;
    }
    const scaleX = this.brushPadCanvas.width / Math.max(1, rect.width);
    const scaleY = this.brushPadCanvas.height / Math.max(1, rect.height);
    return {
      x: localX * scaleX,
      y: localY * scaleY,
    };
  }

  resetBrushPreviewPad({ force = false } = {}) {
    if (!this.brushPadCanvas || (!force && this.brushPreviewPadDirty)) {
      return;
    }

    const canvas = this.brushPadCanvas;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(360, Math.round(rect.width || 480));
    const height = Math.max(320, Math.round(rect.height || 420));
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    paintSampleSurface(ctx, width, height, {
      background: "#171a20",
      grid: true,
    });

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(245, 247, 251, 0.4)";
    ctx.font = '700 16px "SF Pro Display", "Avenir Next", sans-serif';
    ctx.fillText("Draw Here", Math.round(width / 2), Math.round(height / 2));
    ctx.restore();
    this.brushPreviewPadDirty = false;
  }

  beginBrushPreviewStroke(event) {
    const point = this.getBrushPreviewPadPoint(event);
    const brush = this.engine?.brush;
    if (!point || !brush || !["brush", "eraser", "blend"].includes(brush.tool)) {
      return;
    }

    event.preventDefault();
    this.resetBrushPreviewPad();
    const canvas = this.brushPadCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const stroke = {
      startPoint: point,
      lastPoint: point,
      lastRenderedPoint: point,
      lastAngle: 0,
      distance: 0,
      renderedStampCount: 0,
      smoothedVelocity: 0,
      lastTimestamp: event.timeStamp || performance.now(),
      tilt: resolvePreviewTiltState(event),
      pickupColor: sampleCanvasColor(ctx, canvas, point.x, point.y, Math.max(2, Math.round(brush.size * 0.25))),
    };
    this.brushPreviewStroke = stroke;
    this.brushPreviewPadDirty = true;
    this.brushPadCanvas.setPointerCapture?.(event.pointerId);
  }

  moveBrushPreviewStroke(event) {
    if (!this.brushPreviewStroke || !this.brushPadCanvas) {
      return;
    }
    const point = this.getBrushPreviewPadPoint(event);
    const brush = this.engine?.brush;
    if (!point || !brush) {
      return;
    }

    const canvas = this.brushPadCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const stroke = this.brushPreviewStroke;
    const nextTilt = resolvePreviewTiltState(event, stroke.tilt);
    const fromPoint = stroke.lastPoint;
    const deltaX = point.x - fromPoint.x;
    const deltaY = point.y - fromPoint.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.4) {
      return;
    }

    const elapsed = Math.max(8, (event.timeStamp || performance.now()) - (stroke.lastTimestamp || performance.now()));
    const velocity = distance / elapsed;
    const spacing = Math.max(1.2, brush.size * Math.max(0.04, brush.spacing ?? 0.08) * 0.42);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    const initialStrokeStamp = stroke.renderedStampCount === 0;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const nextPoint = {
        x: fromPoint.x + (deltaX * t),
        y: fromPoint.y + (deltaY * t),
      };
      const stampTilt = {
        x: (stroke.tilt?.x ?? 0) + ((nextTilt.x ?? 0) - (stroke.tilt?.x ?? 0)) * t,
        y: (stroke.tilt?.y ?? 0) + ((nextTilt.y ?? 0) - (stroke.tilt?.y ?? 0)) * t,
        magnitude: (stroke.tilt?.magnitude ?? 0) + ((nextTilt.magnitude ?? 0) - (stroke.tilt?.magnitude ?? 0)) * t,
        angle: (stroke.tilt?.angle ?? 0) + ((nextTilt.angle ?? 0) - (stroke.tilt?.angle ?? 0)) * t,
      };
      const segmentDistance = Math.hypot(nextPoint.x - stroke.lastPoint.x, nextPoint.y - stroke.lastPoint.y);
      stroke.distance += segmentDistance;
      stroke.smoothedVelocity = stroke.smoothedVelocity ? (stroke.smoothedVelocity * 0.72) + (velocity * 0.28) : velocity;
      stampBrushDab(ctx, {
        brush,
        point: nextPoint,
        pressure: event.pressure || 1,
        stroke,
        sampleCompositeColor: (x, y, radius) => sampleCanvasColor(ctx, canvas, x, y, radius),
        initial: initialStrokeStamp && step === 1,
        tilt: stampTilt,
      });
      stroke.lastPoint = nextPoint;
      stroke.renderedStampCount = (stroke.renderedStampCount || 0) + 1;
    }
    stroke.lastTimestamp = event.timeStamp || performance.now();
    stroke.tilt = nextTilt;
  }

  endBrushPreviewStroke() {
    if (!this.brushPreviewStroke || !this.brushPadCanvas) {
      this.brushPreviewStroke = null;
      return;
    }
    if ((this.brushPreviewStroke.renderedStampCount || 0) === 0) {
      const brush = this.engine?.brush;
      if (brush) {
        const canvas = this.brushPadCanvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        stampBrushDab(ctx, {
          brush,
          point: this.brushPreviewStroke.startPoint,
          pressure: 1,
          stroke: this.brushPreviewStroke,
          sampleCompositeColor: (x, y, radius) => sampleCanvasColor(ctx, canvas, x, y, radius),
          initial: true,
          tilt: this.brushPreviewStroke.tilt,
        });
      }
    }
    this.brushPreviewStroke = null;
  }

  renderBrushPreview() {
    if (!this.brushPreviewCanvas) {
      return;
    }

    const canvas = this.brushPreviewCanvas;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || 360));
    const height = Math.max(120, Math.round(rect.height || 132));
    const previewSignature = getBrushPreviewSignature(this.engine.brush, {
      width,
      height,
      background: "#13161c",
      sampleColor: this.engine.brush.color,
      grid: true,
    });
    const strokeTool = canvas.dataset.previewSignature === previewSignature
      ? isStrokeTool(this.engine.brush.tool)
      : renderBrushStrokeSample(canvas, this.engine.brush, {
        width,
        height,
        background: "#13161c",
        sampleColor: this.engine.brush.color,
        grid: true,
      });
    canvas.dataset.previewSignature = previewSignature;
    if (!strokeTool) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "rgba(245, 247, 251, 0.74)";
      ctx.font = '600 18px "SF Pro Display", "Avenir Next", sans-serif';
      ctx.fillText("Stroke preview is available for brush, erase, and blend.", 24, Math.floor(height / 2));
      this.brushEditorTitle.textContent = `${this.engine.brush.tool[0].toUpperCase()}${this.engine.brush.tool.slice(1)} Settings`;
      if (this.brushPadHint) {
        this.brushPadHint.textContent = "The drawing pad activates for brush, erase, and blend tools.";
      }
      return;
    }

    this.brushEditorTitle.textContent = `${this.findBrushPreset(this.engine.brush.presetId)?.label || "Brush"} Settings`;
    if (this.brushPadHint) {
      this.brushPadHint.textContent = "Use the drawing pad to test shape, flow, pressure, and blend behavior with the active brush.";
    }
    if (!this.brushPreviewPadDirty) {
      this.resetBrushPreviewPad({ force: true });
    }
  }

  openQuickMenu(clientX = this.lastPointerClient.x, clientY = this.lastPointerClient.y) {
    this.quickMenuOpen = true;
    this.quickMenu.hidden = false;
    this.quickMenu.style.left = `${clientX}px`;
    this.quickMenu.style.top = `${clientY}px`;
    this.root.classList.add("cp-quick-menu-open");
  }

  closeQuickMenu() {
    this.quickMenuOpen = false;
    this.quickMenu.hidden = true;
    this.root.classList.remove("cp-quick-menu-open");
  }

  toggleQuickMenu(clientX = this.lastPointerClient.x, clientY = this.lastPointerClient.y) {
    if (this.quickMenuOpen) {
      this.closeQuickMenu();
      return;
    }
    this.openQuickMenu(clientX, clientY);
  }

  #buildHeader() {
    const createPanelToggle = ({ label, meta = "", panelName, className = "" } = {}) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = ["cp-panel-toggle", className].filter(Boolean).join(" ");
      const labelElement = document.createElement("span");
      labelElement.className = "cp-panel-toggle__label";
      labelElement.textContent = label;
      const metaElement = document.createElement("span");
      metaElement.className = "cp-panel-toggle__meta";
      metaElement.textContent = meta;
      element.append(labelElement, metaElement);
      if (panelName) {
        this.panelButtons[panelName] = element;
        element.addEventListener("click", () => this.togglePanel(panelName));
      }
      return { element, metaElement, labelElement };
    };

    const leftGroup = document.createElement("div");
    leftGroup.className = "cp-header__group cp-header__group--left";

    this.galleryButton = button("Back", "cp-button cp-button--ghost cp-button--tiny");
    this.quickMenuButton = button("Quick", "cp-button cp-button--ghost cp-button--tiny");

    const titleGroup = document.createElement("div");
    titleGroup.className = "cp-header__title";
    const eyebrow = document.createElement("div");
    eyebrow.className = "cp-header__eyebrow";
    eyebrow.textContent = "Studio";
    const nameRow = document.createElement("div");
    nameRow.className = "cp-header__name";
    this.nameInput = textInput("Untitled Sketch");
    this.metaLabel = document.createElement("div");
    this.metaLabel.className = "cp-header__meta";
    this.docPill = document.createElement("div");
    this.docPill.className = "cp-doc-pill";
    this.docSummary = document.createElement("div");
    this.docSummary.className = "cp-header__summary";
    nameRow.append(this.nameInput, this.docPill);
    titleGroup.append(eyebrow, nameRow, this.metaLabel, this.docSummary);
    leftGroup.append(this.galleryButton, this.quickMenuButton, titleGroup);

    const centerGroup = document.createElement("div");
    centerGroup.className = "cp-header__group cp-header__group--center";
    this.undoButton = button("Undo", "cp-button cp-button--tiny");
    this.redoButton = button("Redo", "cp-button cp-button--tiny");
    decorateHistoryButton(this.undoButton, "undo");
    decorateHistoryButton(this.redoButton, "redo");
    this.statusBadge = document.createElement("div");
    this.statusBadge.className = "cp-status";
    centerGroup.append(this.undoButton, this.redoButton, this.statusBadge);

    const rightGroup = document.createElement("div");
    rightGroup.className = "cp-header__group cp-header__group--right";

    const brushPanelButton = createPanelToggle({
      label: "Brush",
      meta: "Brush library",
      panelName: "brushLibrary",
      className: "cp-panel-toggle--wide cp-panel-toggle--brush",
    });
    this.brushReadout = brushPanelButton.labelElement;
    this.brushPanelButtonMeta = brushPanelButton.metaElement;
    brushPanelButton.element.addEventListener("dblclick", () => this.openBrushEditor());

    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "cp-panel-toggle cp-panel-toggle--color";
    this.panelButtons.color = colorButton;
    this.colorPanelButtonSwatch = document.createElement("span");
    this.colorPanelButtonSwatch.className = "cp-panel-toggle__swatch";
    const colorLabel = document.createElement("span");
    colorLabel.className = "cp-panel-toggle__label";
    colorLabel.textContent = "Color";
    colorButton.append(this.colorPanelButtonSwatch, colorLabel);
    colorButton.addEventListener("click", () => this.togglePanel("color"));

    const layersButton = createPanelToggle({
      label: "Layers",
      meta: "Stack",
      panelName: "layers",
      className: "cp-panel-toggle--compact",
    });
    const splitButton = createPanelToggle({
      label: "Split",
      meta: "Stream",
      className: "cp-panel-toggle--compact",
    });
    this.panelButtons.splitView = splitButton.element;
    splitButton.element.addEventListener("click", () => this.toggleSplitView());
    const documentButton = createPanelToggle({
      label: "Canvas",
      meta: "Assist",
      panelName: "document",
      className: "cp-panel-toggle--compact",
    });
    const guidesButton = createPanelToggle({
      label: "Guides",
      meta: "Overlay",
      className: "cp-panel-toggle--compact",
    });
    this.panelButtons.guides = guidesButton.element;
    guidesButton.element.addEventListener("click", () => {
      this.showCanvasGuides = !this.showCanvasGuides;
      this.refreshCanvasOverlay();
    });

    rightGroup.append(
      brushPanelButton.element,
      colorButton,
      layersButton.element,
      splitButton.element,
      documentButton.element,
      guidesButton.element,
    );

    this.presetButtons = [];
    this.header.append(leftGroup, centerGroup, rightGroup);
  }

  #buildToolbar() {
    const rails = document.createElement("div");
    rails.className = "cp-toolbar__rails";

    const sizeRail = document.createElement("div");
    sizeRail.className = "cp-rail";
    const sizeTag = document.createElement("div");
    sizeTag.className = "cp-rail__tag";
    sizeTag.textContent = "Size";
    this.toolbarSizeLabel = document.createElement("div");
    this.toolbarSizeLabel.className = "cp-rail__value";
    this.toolbarSizeInput = slider(1, 240, 1, BRUSH_PRESETS[0].size);
    this.toolbarSizeInput.className = "cp-rail__slider";
    sizeRail.append(sizeTag, this.toolbarSizeLabel, this.toolbarSizeInput);

    const opacityRail = document.createElement("div");
    opacityRail.className = "cp-rail";
    const opacityTag = document.createElement("div");
    opacityTag.className = "cp-rail__tag";
    opacityTag.textContent = "Opacity";
    this.toolbarOpacityLabel = document.createElement("div");
    this.toolbarOpacityLabel.className = "cp-rail__value";
    this.toolbarOpacityInput = slider(0.01, 1, 0.01, BRUSH_PRESETS[0].opacity);
    this.toolbarOpacityInput.className = "cp-rail__slider";
    opacityRail.append(opacityTag, this.toolbarOpacityLabel, this.toolbarOpacityInput);

    rails.append(sizeRail, opacityRail);
    this.interfaceToggleButton = button("Hide UI", "cp-button cp-button--tiny cp-toolbar__ui-toggle");
    this.interfaceToggleButton.title = "Toggle Studio UI (F or Tab)";
    this.toolbar.append(rails, this.interfaceToggleButton);
    this.toolButtons = [];
  }

  #buildInspector() {
    const brushPanel = document.createElement("section");
    brushPanel.className = "cp-panel--brush-editor";
    this.toolHint = document.createElement("div");
    this.toolHint.className = "cp-hint";
    this.brushControlRegistry = {};
    this.brushEditorSections = Object.fromEntries(
      BRUSH_EDITOR_SECTIONS.map((section) => [section.id, this.#subPanel(section.title)]),
    );
    BRUSH_EDITOR_CONTROLS.forEach((definition) => {
      const control = this.createBrushEditorControlField(definition);
      this.brushControlRegistry[definition.key] = control;
      this.brushEditorSections[definition.section]?.appendChild(control.wrapper);
    });
    this.assistEmptyState = document.createElement("div");
    this.assistEmptyState.className = "cp-subpanel__empty";
    this.assistEmptyState.hidden = true;
    this.brushEditorSections.assist?.append(this.assistEmptyState);
    brushPanel.append(
      ...BRUSH_EDITOR_SECTIONS.map((section) => this.brushEditorSections[section.id]),
      this.toolHint,
    );

    this.panelRegistry = {};

    this.brushLibraryPanel = document.createElement("section");
    this.brushLibraryPanel.className = "cp-panel cp-panel--brush-library";
    const brushLibraryHeader = this.#panelHeader("Brush Library", "Select a preset or tune the active brush.");
    this.brushLibrarySubtitle = brushLibraryHeader.subtitle;
    this.brushNewButton = button("+ New Brush", "cp-button cp-button--ghost cp-button--tiny");
    this.brushEditorButton = button("Edit", "cp-button cp-button--ghost cp-button--tiny");
    brushLibraryHeader.actions.append(this.brushNewButton, this.brushEditorButton);
    this.brushLibraryPanel.append(brushLibraryHeader.header);

    const toolRail = document.createElement("div");
    toolRail.className = "cp-brush-library__tools";
    this.toolButtons = TOOLS.map((tool) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "cp-mini-tool";
      element.dataset.toolId = tool.id;
      element.innerHTML = `<span class="cp-mini-tool__icon">${tool.icon}</span><span class="cp-mini-tool__label">${tool.label}</span>`;
      element.title = `${tool.label} · ${KEY_HINTS[tool.id] || ""}`.trim();
      element.addEventListener("click", () => {
        this.setBrushTool(tool.id);
      });
      toolRail.appendChild(element);
      return element;
    });
    this.brushLibraryPanel.append(toolRail);

    const brushLibraryBody = document.createElement("div");
    brushLibraryBody.className = "cp-brush-library";

    this.brushLibraryList = document.createElement("div");
    this.brushLibraryList.className = "cp-brush-library__list";
    this.brushLibraryEmptyState = document.createElement("div");
    this.brushLibraryEmptyState.className = "cp-brush-library__empty";
    this.brushLibraryEmptyState.hidden = true;
    brushLibraryBody.append(this.brushLibraryList, this.brushLibraryEmptyState);
    this.brushLibraryPanel.append(brushLibraryBody);

    this.colorPanel = document.createElement("section");
    this.colorPanel.className = "cp-panel cp-panel--color";
    const colorHeader = this.#panelHeader("Colors", "Current, previous, recent, and swatches.");
    this.colorPanel.append(colorHeader.header);
    const colorSection = document.createElement("section");
    colorSection.className = "cp-color-section cp-color-section--disc";
    this.colorWheel.mount(colorSection);
    this.hexInput = textInput("#111111");
    this.hexInput.maxLength = 7;
    this.colorPreview = document.createElement("button");
    this.colorPreview.type = "button";
    this.colorPreview.className = "cp-color-preview";
    this.previousColorPreview = document.createElement("button");
    this.previousColorPreview.type = "button";
    this.previousColorPreview.className = "cp-color-preview cp-color-preview--previous";
    const colorPair = document.createElement("div");
    colorPair.className = "cp-color-pair";
    colorPair.append(this.colorPreview, this.previousColorPreview);
    colorSection.append(colorPair, createField("Hex", this.hexInput));

    const historyLabel = document.createElement("div");
    historyLabel.className = "cp-header__eyebrow";
    historyLabel.textContent = "Recent";
    const historyStrip = document.createElement("div");
    historyStrip.className = "cp-color-history";
    this.colorHistoryButtons = Array.from({ length: 12 }, () => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "cp-color-history__swatch";
      element.hidden = true;
      element.addEventListener("click", () => {
        const color = element.dataset.color;
        if (!color) {
          return;
        }
        this.engine.setBrushColor(color);
        this.colorWheel.setHex(color, { silent: true });
        this.syncBrushControls();
        this.syncSwatches();
      });
      historyStrip.appendChild(element);
      return element;
    });
    colorSection.append(historyLabel, historyStrip);

    const swatches = document.createElement("div");
    swatches.className = "cp-swatches";
    this.swatchButtons = DEFAULT_SWATCHES.map((color) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "cp-swatch";
      element.dataset.color = color;
      element.style.background = color;
      element.addEventListener("click", () => {
        this.engine.setBrushColor(color);
        this.colorWheel.setHex(color, { silent: true });
        this.syncBrushControls();
        this.syncSwatches();
      });
      swatches.appendChild(element);
      return element;
    });
    colorSection.append(swatches);
    this.colorPanel.append(colorSection);

    this.documentPanel = document.createElement("section");
    this.documentPanel.className = "cp-panel cp-panel--document";
    const documentHeader = this.#panelHeader("Canvas", "Import, export, and working-view assists.");
    this.documentPanel.append(documentHeader.header);
    this.backgroundModeSelect = select(
      [
        { value: "transparent", label: "Transparent" },
        { value: "solid", label: "Solid Paper" },
      ],
      "transparent",
    );
    this.backgroundColorInput = textInput("#ffffff");
    this.canvasRotationInput = slider(-180, 180, 1, 0);
    this.canvasRotationLabel = document.createElement("div");
    this.symmetryModeSelect = select(CANVAS_SYMMETRY_OPTIONS, "off");
    this.strokeConstraintSelect = select(STROKE_CONSTRAINT_OPTIONS, 0);
    this.importImageButton = button("Import Image", "cp-button cp-button--tiny");
    this.openProjectButton = button("Open Project", "cp-button cp-button--tiny");
    this.exportButton = button("Export PNG", "cp-button cp-button--tiny");
    this.saveProjectButton = button("Save Project", "cp-button cp-button--tiny");
    this.saveButton = button("Save", "cp-button cp-primary cp-button--tiny");
    this.fitButton = button("Fit", "cp-button cp-button--tiny");
    this.canvasActualQuickButton = button("100%", "cp-button cp-button--tiny");
    this.canvasGuidesQuickButton = button("Guides", "cp-button cp-button--tiny");
    this.canvasRotateLeftButton = button("Rotate -", "cp-button cp-button--tiny");
    this.canvasRotateRightButton = button("Rotate +", "cp-button cp-button--tiny");
    this.canvasAssistHint = document.createElement("div");
    this.canvasAssistHint.className = "cp-hint";
    this.canvasAssistHint.textContent = "Rotation affects the working view only. Symmetry mirrors paint, and Shift starts a 45deg snapped line when Line Assist is off.";
    this.flattenExportHint = document.createElement("div");
    this.flattenExportHint.className = "cp-hint";
    this.flattenExportHint.textContent = "Project files keep layers, blend modes, locks, background, and assists. PNG export bakes the visible result.";
    this.documentPanel.append(
      this.#actionRow(this.openProjectButton, this.saveProjectButton),
      this.#actionRow(this.importImageButton, this.exportButton, this.saveButton),
      this.#actionRow(this.fitButton, this.canvasActualQuickButton, this.canvasGuidesQuickButton),
      this.#actionRow(this.canvasRotateLeftButton, this.canvasRotateRightButton),
      createField("Background", this.backgroundModeSelect),
      createField("Paper Color", this.backgroundColorInput),
      this.#fieldWithValue("Canvas Rotation", this.canvasRotationInput, this.canvasRotationLabel),
      createField("Symmetry", this.symmetryModeSelect),
      createField("Line Assist", this.strokeConstraintSelect),
      this.canvasAssistHint,
      this.flattenExportHint,
    );

    this.layersPanel = document.createElement("section");
    this.layersPanel.className = "cp-panel cp-panel--layers";
    const layersHeader = this.#panelHeader("Layers", "Arrange the active stack.");
    this.layerAddButton = button("New", "cp-button cp-button--tiny");
    layersHeader.actions.append(this.layerAddButton);
    this.layersPanel.append(layersHeader.header);
    this.layerDuplicateButton = button("Duplicate", "cp-button cp-button--tiny");
    this.layerMergeButton = button("Merge Down", "cp-button cp-button--tiny");
    this.layerClearButton = button("Clear", "cp-button cp-button--tiny");
    this.layerDeleteButton = button("Delete", "cp-button cp-button--tiny");
    this.layersList = document.createElement("div");
    this.layersList.className = "cp-layers";
    this.layersPanel.append(this.layersList);

    this.panelRegistry = {
      brushLibrary: { panel: this.brushLibraryPanel, header: brushLibraryHeader.header },
      color: { panel: this.colorPanel, header: colorHeader.header },
      document: { panel: this.documentPanel, header: documentHeader.header },
      layers: { panel: this.layersPanel, header: layersHeader.header },
    };

    this.#buildBrushEditor(brushPanel);
    this.inspector.append(this.brushLibraryPanel, this.layersPanel, this.colorPanel, this.documentPanel);
    Object.entries(this.panelRegistry).forEach(([panelName, { panel, header }]) => {
      this.#bindPanelDrag(panelName, panel, header);
    });
  }

  #fieldWithValue(labelText, inputElement, valueElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "cp-control";
    const row = document.createElement("div");
    row.className = "cp-panel__row";
    const label = document.createElement("label");
    label.textContent = labelText;
    valueElement.className = "cp-hint";
    row.append(label, valueElement);
    wrapper.append(row, inputElement);
    return wrapper;
  }

  #panelHeader(title, subtitle) {
    const header = document.createElement("div");
    header.className = "cp-panel__header";

    const meta = document.createElement("div");
    meta.className = "cp-panel__header-meta";

    const titleElement = document.createElement("div");
    titleElement.className = "cp-panel__title";
    titleElement.textContent = title;

    const subtitleElement = document.createElement("div");
    subtitleElement.className = "cp-panel__subtitle";
    subtitleElement.textContent = subtitle;

    const actions = document.createElement("div");
    actions.className = "cp-panel__header-actions";

    meta.append(titleElement, subtitleElement);
    header.append(meta, actions);
    return {
      header,
      title: titleElement,
      subtitle: subtitleElement,
      actions,
    };
  }

  #bindPanelDrag(panelName, panel, header) {
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".cp-panel__header-actions")) {
        return;
      }
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      panel.setPointerCapture?.(event.pointerId);
      this.panelDragState = {
        panelName,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
      };
      panel.classList.add("cp-panel--dragging");
    });

    header.addEventListener("dblclick", (event) => {
      if (event.target.closest(".cp-panel__header-actions")) {
        return;
      }
      this.resetPanelPosition(panelName);
    });
  }

  #buildQuickMenu() {
    const center = document.createElement("button");
    center.type = "button";
    center.className = "cp-quick-menu__center";
    center.textContent = "Quick";
    center.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeQuickMenu();
    });
    this.quickMenu.appendChild(center);

    const entries = [
      {
        label: "Brush",
        slot: "top",
        action: () => this.togglePanel("brushLibrary", true),
      },
      {
        label: "Color",
        slot: "top-right",
        action: () => this.togglePanel("color", true),
      },
      {
        label: "Layers",
        slot: "bottom-right",
        action: () => this.togglePanel("layers", true),
      },
      {
        label: "Fit",
        slot: "bottom",
        action: () => this.engine.fitToView(),
      },
      {
        label: "Undo",
        slot: "bottom-left",
        action: () => this.engine.undo(),
      },
      {
        label: "Redo",
        slot: "top-left",
        action: () => this.engine.redo(),
      },
    ];

    entries.forEach((entry) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `cp-quick-menu__item cp-quick-menu__item--${entry.slot}`;
      element.textContent = entry.label;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeQuickMenu();
        entry.action();
      });
      this.quickMenu.appendChild(element);
    });
  }

  #subPanel(title, ...content) {
    const section = document.createElement("section");
    section.className = "cp-subpanel";
    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading, ...content);
    return section;
  }

  #actionRow(...buttons) {
    const row = document.createElement("div");
    row.className = "cp-actions";
    buttons.forEach((element) => row.appendChild(element));
    return row;
  }

  #buildBrushEditor(brushPanel) {
    this.brushEditorOverlay = document.createElement("div");
    this.brushEditorOverlay.className = "cp-brush-editor";
    this.brushEditorOverlay.hidden = true;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "cp-brush-editor__backdrop";
    backdrop.setAttribute("aria-label", "Close brush editor");

    const windowCard = document.createElement("section");
    windowCard.className = "cp-brush-editor__window";

    const header = document.createElement("div");
    header.className = "cp-brush-editor__header";
    const headerMeta = document.createElement("div");
    headerMeta.className = "cp-brush-editor__meta";
    const eyebrow = document.createElement("div");
    eyebrow.className = "cp-header__eyebrow";
    eyebrow.textContent = "Brush Tuning";
    this.brushEditorTitle = document.createElement("div");
    this.brushEditorTitle.className = "cp-brush-editor__title";
    headerMeta.append(eyebrow, this.brushEditorTitle);
    const headerActions = document.createElement("div");
    headerActions.className = "cp-brush-editor__actions";
    this.brushEditorSaveButton = button("Save", "cp-button cp-button--ghost cp-button--tiny");
    this.brushEditorDuplicateButton = button("Save As New", "cp-button cp-button--ghost cp-button--tiny");
    this.brushEditorCloseButton = button("Done", "cp-button cp-primary");
    headerActions.append(this.brushEditorSaveButton, this.brushEditorDuplicateButton, this.brushEditorCloseButton);
    header.append(headerMeta, headerActions);

    const body = document.createElement("div");
    body.className = "cp-brush-editor__body";

    const navigation = document.createElement("nav");
    navigation.className = "cp-brush-editor__nav";
    this.brushEditorSectionButtons = BRUSH_EDITOR_SECTIONS.map((section) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "cp-brush-editor__nav-button";
      element.dataset.section = section.id;
      element.textContent = section.label;
      element.addEventListener("click", () => this.setBrushEditorSection(section.id));
      navigation.appendChild(element);
      return element;
    });

    const controlsColumn = document.createElement("section");
    controlsColumn.className = "cp-brush-editor__controls";
    const controlsMeta = document.createElement("div");
    controlsMeta.className = "cp-brush-editor__controls-meta";
    const controlsLabel = document.createElement("div");
    controlsLabel.className = "cp-header__eyebrow";
    controlsLabel.textContent = "Settings";
    this.brushEditorSectionTitleLabel = document.createElement("div");
    this.brushEditorSectionTitleLabel.className = "cp-brush-editor__controls-title";
    this.brushEditorSectionHintLabel = document.createElement("div");
    this.brushEditorSectionHintLabel.className = "cp-brush-editor__controls-copy";
    controlsMeta.append(controlsLabel, this.brushEditorSectionTitleLabel, this.brushEditorSectionHintLabel);

    this.brushEditorSummary = document.createElement("section");
    this.brushEditorSummary.className = "cp-brush-editor__summary";
    const brushEditorSummaryMain = document.createElement("div");
    brushEditorSummaryMain.className = "cp-brush-editor__summary-main";
    this.brushEditorSummarySwatch = document.createElement("div");
    this.brushEditorSummarySwatch.className = "cp-brush-editor__summary-swatch";
    const brushEditorSummaryMeta = document.createElement("div");
    brushEditorSummaryMeta.className = "cp-brush-editor__summary-meta";
    const brushEditorSummaryEyebrow = document.createElement("div");
    brushEditorSummaryEyebrow.className = "cp-header__eyebrow";
    brushEditorSummaryEyebrow.textContent = "Active Brush";
    this.brushEditorSummaryTitle = document.createElement("div");
    this.brushEditorSummaryTitle.className = "cp-brush-editor__summary-title";
    this.brushEditorSummaryCopy = document.createElement("div");
    this.brushEditorSummaryCopy.className = "cp-brush-editor__summary-copy";
    brushEditorSummaryMeta.append(brushEditorSummaryEyebrow, this.brushEditorSummaryTitle, this.brushEditorSummaryCopy);
    brushEditorSummaryMain.append(this.brushEditorSummarySwatch, brushEditorSummaryMeta);
    const brushEditorSummaryPills = document.createElement("div");
    brushEditorSummaryPills.className = "cp-brush-editor__summary-pills";
    this.brushEditorSummaryToolPill = document.createElement("span");
    this.brushEditorSummaryToolPill.className = "cp-brush-editor__pill cp-brush-editor__pill--accent";
    this.brushEditorSummaryFamilyPill = document.createElement("span");
    this.brushEditorSummaryFamilyPill.className = "cp-brush-editor__pill";
    this.brushEditorSummarySizePill = document.createElement("span");
    this.brushEditorSummarySizePill.className = "cp-brush-editor__pill";
    this.brushEditorSummaryResponsePill = document.createElement("span");
    this.brushEditorSummaryResponsePill.className = "cp-brush-editor__pill";
    brushEditorSummaryPills.append(
      this.brushEditorSummaryToolPill,
      this.brushEditorSummaryFamilyPill,
      this.brushEditorSummarySizePill,
      this.brushEditorSummaryResponsePill,
    );
    this.brushEditorSummary.append(brushEditorSummaryMain, brushEditorSummaryPills);

    const previewCard = document.createElement("section");
    previewCard.className = "cp-brush-editor__preview";
    const previewHeader = document.createElement("div");
    previewHeader.className = "cp-brush-editor__preview-header";
    const previewMeta = document.createElement("div");
    previewMeta.className = "cp-brush-editor__preview-meta";
    const previewLabel = document.createElement("div");
    previewLabel.className = "cp-header__eyebrow";
    previewLabel.textContent = "Stroke Sample";
    this.brushPadHint = document.createElement("div");
    this.brushPadHint.className = "cp-hint";
    previewMeta.append(previewLabel, this.brushPadHint);
    const previewActions = document.createElement("div");
    previewActions.className = "cp-brush-editor__preview-actions";
    this.brushPadClearButton = button("Clear Pad", "cp-button cp-button--ghost cp-button--tiny");
    previewActions.append(this.brushPadClearButton);
    previewHeader.append(previewMeta, previewActions);

    this.brushPreviewCanvas = document.createElement("canvas");
    this.brushPreviewCanvas.className = "cp-brush-editor__sample-canvas";
    const padFrame = document.createElement("div");
    padFrame.className = "cp-brush-editor__pad";
    this.brushPadCanvas = document.createElement("canvas");
    this.brushPadCanvas.className = "cp-brush-editor__pad-canvas";
    padFrame.append(this.brushPadCanvas);
    previewCard.append(previewHeader, this.brushPreviewCanvas, padFrame);

    brushPanel.classList.add("cp-panel--brush-editor");
    controlsColumn.append(controlsMeta, this.brushEditorSummary, brushPanel);
    body.append(navigation, controlsColumn, previewCard);
    windowCard.append(header, body);
    this.brushEditorOverlay.append(backdrop, windowCard);
    this.root.appendChild(this.brushEditorOverlay);

    this.brushPadCanvas.addEventListener("pointerdown", (event) => this.beginBrushPreviewStroke(event));
    this.brushPadCanvas.addEventListener("pointermove", (event) => this.moveBrushPreviewStroke(event));
    this.brushPadCanvas.addEventListener("pointerup", () => this.endBrushPreviewStroke());
    this.brushPadCanvas.addEventListener("pointerleave", () => this.endBrushPreviewStroke());
    this.brushPadCanvas.addEventListener("pointercancel", () => this.endBrushPreviewStroke());
  }

  #bindEvents() {
    const resizeObserver = new ResizeObserver(() => {
      if (this.isOpen) {
        Object.keys(this.panelRegistry || {}).forEach((panelName) => {
          this.syncPanelPosition(panelName);
          this.syncDefaultPanelPosition(panelName);
        });
        this.engine.render();
        this.refreshCanvasOverlay();
        if (this.brushEditorOpen) {
          this.renderBrushPreview();
        }
      }
    });
    resizeObserver.observe(this.stage);

    this.nameInput.addEventListener("change", () => {
      this.engine.updateDocumentMeta({ name: this.nameInput.value || "Untitled Sketch" });
    });

    this.undoButton.addEventListener("click", () => this.engine.undo());
    this.redoButton.addEventListener("click", () => this.engine.redo());
    this.importImageButton.addEventListener("click", () => this.fileInput.click());
    this.openProjectButton.addEventListener("click", () => this.projectFileInput.click());
    this.saveProjectButton.addEventListener("click", () => {
      this.saveProjectFile().catch((error) => {
        this.setStatus(`Project export failed · ${error.message}`);
      });
    });
    this.exportButton.addEventListener("click", async () => {
      const blob = await this.engine.exportBlob({ flattenBackground: this.engine.document.background?.mode === "solid" });
      downloadBlob(blob, `${(this.engine.document.name || "comfypencil").replace(/\s+/g, "_").toLowerCase()}.png`);
    });
    this.fitButton.addEventListener("click", () => this.engine.fitToView());
    this.saveButton.addEventListener("click", () => this.saveNow({ force: true }).catch(() => {}));
    this.galleryButton.addEventListener("click", () => this.close());
    this.quickMenuButton.addEventListener("click", (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      this.toggleQuickMenu(bounds.left + (bounds.width / 2), bounds.bottom + 84);
    });
    this.brushNewButton.addEventListener("click", () => this.createNewBrushPreset());
    this.brushEditorButton.addEventListener("click", () => this.openBrushEditor());
    this.interfaceToggleButton?.addEventListener("click", () => this.toggleInterfaceHidden());
    this.streamRefreshButton.addEventListener("click", () => {
      this.runBackgroundWorkflow({ reason: "manual" }).catch(() => {});
    });
    this.streamAutoRunButton?.addEventListener("click", () => {
      this.startIncomingStreamAutoRun({
        intervalSeconds: Number(this.streamIntervalSelect?.value || this.streamAutoRunSeconds),
      });
    });
    this.streamIntervalSelect?.addEventListener("change", () => {
      const nextSeconds = Number(this.streamIntervalSelect.value || this.streamAutoRunSeconds);
      this.streamAutoRunSeconds = [3, 5, 10].includes(nextSeconds) ? nextSeconds : 5;
      if (this.streamAutoRunActive) {
        this.startIncomingStreamAutoRun({
          intervalSeconds: this.streamAutoRunSeconds,
          runImmediately: false,
        });
      } else {
        this.syncIncomingStreamControls();
      }
    });
    this.streamStopButton?.addEventListener("click", () => {
      this.stopIncomingStreamAutoRun().catch(() => {});
    });
    this.streamExportButton?.addEventListener("click", () => {
      this.exportIncomingStreamToCanvas().catch(() => {});
    });
    this.canvasActualQuickButton.addEventListener("click", () => this.engine.setZoom(1, { resetPan: true }));
    this.canvasGuidesQuickButton.addEventListener("click", () => {
      this.showCanvasGuides = !this.showCanvasGuides;
      this.refreshCanvasOverlay();
    });
    this.canvasRotateLeftButton.addEventListener("click", () => this.engine.rotateCanvasBy(-15));
    this.canvasRotateRightButton.addEventListener("click", () => this.engine.rotateCanvasBy(15));
    this.brushPadClearButton.addEventListener("click", () => this.resetBrushPreviewPad({ force: true }));

    this.toolbarSizeInput.addEventListener("input", () => this.engine.patchBrush({ size: Number(this.toolbarSizeInput.value) }));
    this.toolbarOpacityInput.addEventListener("input", () => this.engine.patchBrush({ opacity: Number(this.toolbarOpacityInput.value) }));
    Object.values(this.brushControlRegistry || {}).forEach(({ definition, input }) => {
      const eventName = definition.type === "select" ? "change" : "input";
      input.addEventListener(eventName, () => {
        this.commitBrushEditorControl(definition, input.value);
      });
    });
    this.colorPreview.addEventListener("click", () => this.hexInput.focus());
    this.previousColorPreview.addEventListener("click", () => {
      this.engine.setBrushColor(this.previousColor);
      this.colorWheel.setHex(this.previousColor, { silent: true });
      this.syncBrushControls();
      this.syncSwatches();
    });

    this.hexInput.addEventListener("change", () => {
      const hex = this.hexInput.value.startsWith("#") ? this.hexInput.value : `#${this.hexInput.value}`;
      this.engine.setBrushColor(hex.slice(0, 7));
      this.colorWheel.setHex(hex.slice(0, 7), { silent: true });
      this.syncBrushControls();
      this.syncSwatches();
    });

    this.backgroundModeSelect.addEventListener("change", () => {
      this.engine.updateDocumentMeta({
        background: {
          mode: this.backgroundModeSelect.value,
        },
      });
    });
    this.backgroundColorInput.addEventListener("change", () => {
      const color = this.backgroundColorInput.value.startsWith("#") ? this.backgroundColorInput.value : `#${this.backgroundColorInput.value}`;
      this.engine.updateDocumentMeta({
        background: {
          color: color.slice(0, 7),
        },
      });
    });
    this.canvasRotationInput.addEventListener("input", () => {
      this.engine.setCanvasRotation(Number(this.canvasRotationInput.value));
    });
    this.symmetryModeSelect.addEventListener("change", () => {
      this.engine.updateDocumentMeta({
        assist: {
          symmetry: this.symmetryModeSelect.value,
        },
      });
    });
    this.strokeConstraintSelect.addEventListener("change", () => {
      this.engine.setStrokeConstraintDegrees(Number(this.strokeConstraintSelect.value));
    });
    this.brushEditorSaveButton.addEventListener("click", () => this.saveActiveBrushPreset());
    this.brushEditorDuplicateButton.addEventListener("click", () => this.saveActiveBrushPresetAsNew());
    this.brushEditorCloseButton.addEventListener("click", () => this.closeBrushEditor());
    this.brushEditorOverlay.querySelector(".cp-brush-editor__backdrop").addEventListener("click", () => this.closeBrushEditor());

    this.layerAddButton.addEventListener("click", () => this.engine.addLayer());
    this.layerDuplicateButton.addEventListener("click", () => this.engine.duplicateActiveLayer());
    this.layerMergeButton.addEventListener("click", () => this.engine.mergeActiveLayerDown());
    this.layerClearButton.addEventListener("click", () => this.engine.clearActiveLayer());
    this.layerDeleteButton.addEventListener("click", () => this.engine.deleteActiveLayer());

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", async () => {
      const [file] = this.fileInput.files || [];
      if (file) {
        await this.engine.importFile(file);
      }
      this.fileInput.value = "";
    });
    document.body.appendChild(this.fileInput);

    this.projectFileInput = document.createElement("input");
    this.projectFileInput.type = "file";
    this.projectFileInput.accept = ".pencilstudio,application/json";
    this.projectFileInput.hidden = true;
    this.projectFileInput.addEventListener("change", async () => {
      const [file] = this.projectFileInput.files || [];
      if (file) {
        try {
          await this.openProjectFile(file);
        } catch (error) {
          this.setStatus(`Project open failed · ${error.message}`);
        }
      }
      this.projectFileInput.value = "";
    });
    document.body.appendChild(this.projectFileInput);

    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        this.engine.zoomAt(event.clientX, event.clientY, factor);
      },
      { passive: false },
    );

    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      if (event.button === 2) {
        return;
      }
      if (this.quickMenuOpen) {
        this.closeQuickMenu();
      }
      this.updateCanvasCursor(event);
      this.engine.beginInteraction(event, { temporaryPan: this.spacePanning });
      this.renderStrokeGuide();
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.isOpen) {
        return;
      }
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      this.updateCanvasCursor(event);
      this.renderStrokeGuide();
    });

    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      this.toggleQuickMenu(event.clientX, event.clientY);
    });

    this.canvas.addEventListener("pointerleave", () => {
      if (!this.isOpen) {
        return;
      }
      this.hideCanvasCursor();
    });

    window.addEventListener("pointermove", (event) => {
      if (!this.isOpen) {
        return;
      }
      if (this.panelDragState) {
        this.setPanelPosition(
          this.panelDragState.panelName,
          event.clientX - this.panelDragState.offsetX,
          event.clientY - this.panelDragState.offsetY,
        );
        return;
      }
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      this.engine.moveInteraction(event, { temporaryPan: this.spacePanning });
      this.updateCanvasCursor(event);
      this.renderStrokeGuide();
      if (this.engine.panningState) {
        this.renderNavigator();
      }
    });

    window.addEventListener("pointerup", () => {
      if (!this.isOpen) {
        return;
      }
      if (this.panelDragState) {
        const panel = this.panelRegistry?.[this.panelDragState.panelName]?.panel;
        panel?.classList.remove("cp-panel--dragging");
        this.panelDragState = null;
      }
      this.engine.endInteraction();
      this.refreshCanvasOverlay();
      this.renderStrokeGuide();
    });

    window.addEventListener("pointerdown", (event) => {
      if (!this.isOpen || !this.quickMenuOpen) {
        return;
      }
      if (this.quickMenu.contains(event.target)) {
        return;
      }
      this.closeQuickMenu();
    });

    window.addEventListener("keydown", (event) => {
      if (!this.isOpen) {
        return;
      }

      if (event.key === " ") {
        this.spacePanning = true;
      }

      const metaKey = event.metaKey || event.ctrlKey;
      if (metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.saveNow({ force: true }).catch(() => {});
        return;
      }
      if (metaKey && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        this.engine.undo();
        return;
      }
      if (metaKey && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        this.engine.redo();
        return;
      }

      if (isTextEntryElement(event.target) && event.key !== "Escape") {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "escape" && this.brushEditorOpen) {
        event.preventDefault();
        this.closeBrushEditor();
      } else if (key === "escape" && this.quickMenuOpen) {
        event.preventDefault();
        this.closeQuickMenu();
      } else if (key === "escape") {
        event.preventDefault();
        this.close();
      } else if (key === "f" || key === "tab") {
        event.preventDefault();
        this.toggleInterfaceHidden();
      } else if (key === "q") {
        event.preventDefault();
        this.toggleQuickMenu();
      } else if (key === "v") {
        this.toggleSplitView();
      } else if (key === "b") {
        this.setBrushTool("brush");
      } else if (key === "e") {
        this.setBrushTool("eraser");
      } else if (key === "m") {
        this.setBrushTool("blend");
      } else if (key === "g") {
        this.setBrushTool("fill");
      } else if (key === "i") {
        this.setBrushTool("eyedropper");
      } else if (key === "h") {
        this.setBrushTool("pan");
      } else if (event.key === "[") {
        this.engine.patchBrush({ size: Math.max(1, this.engine.brush.size - 2) });
      } else if (event.key === "]") {
        this.engine.patchBrush({ size: Math.min(240, this.engine.brush.size + 2) });
      } else if (event.key === ",") {
        this.engine.rotateCanvasBy(-15);
      } else if (event.key === ".") {
        this.engine.rotateCanvasBy(15);
      } else if (event.key === "\\") {
        this.engine.updateDocumentMeta({
          assist: {
            symmetry: getNextSymmetryMode(this.engine.getSymmetryMode()),
          },
        });
      } else if (key === "l") {
        this.engine.setStrokeConstraintDegrees(getNextStrokeConstraint(this.engine.getStrokeConstraintDegrees()));
      }
      if (!["b", "e", "m", "g", "i", "h"].includes(key)) {
        this.syncBrushControls();
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === " ") {
        this.spacePanning = false;
      }
    });
  }

  async #ensureDocumentLoaded() {
    const documentId = String(getWidgetValue(this.node, "document_id", "") || "").trim();
    if (!documentId) {
      const created = await createDocument({
        name: String(getWidgetValue(this.node, "document_name", "Untitled Sketch")),
        width: Number(getWidgetValue(this.node, "canvas_width", 1024)),
        height: Number(getWidgetValue(this.node, "canvas_height", 1024)),
        backgroundMode: String(getWidgetValue(this.node, "background_mode", "transparent")),
        backgroundColor: String(getWidgetValue(this.node, "background_color", "#ffffff")),
      });
      this.#syncNodeWidgets(created);
      return created;
    }

    return loadDocument(documentId);
  }

  #syncNodeWidgets(document) {
    setWidgetValue(this.node, "document_name", document.name || "Untitled Sketch");
    setWidgetValue(this.node, "document_id", document.id || "");
    setWidgetValue(this.node, "revision", Number(document.revision || 0));
    setWidgetValue(this.node, "canvas_width", Number(document.width || 1024));
    setWidgetValue(this.node, "canvas_height", Number(document.height || 1024));
    setWidgetValue(this.node, "background_mode", document.background?.mode || "transparent");
    setWidgetValue(this.node, "background_color", document.background?.color || "#ffffff");
  }
}
