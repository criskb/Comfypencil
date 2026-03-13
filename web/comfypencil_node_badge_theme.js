import { app } from "/scripts/app.js";

const EXTENSION_NAME = "ComfyPencil.NodeBadgeTheme";
const BADGE_TEXT = "ComfyPencil";
const BADGE_FG = "#D2FD51";
const BADGE_BG = "#1F1F1F";
const BADGE_POSITION_TOP_RIGHT = "top-right";
const BADGE_REFRESH_RETRY_MS = 90;
const BADGE_MAX_RETRIES = 30;
const VUE_BADGE_STYLE_ID = "comfypencil-vue-node-badge-theme";
const VUE_BADGE_OVERLAY_ATTR = "data-comfypencil-vue-overlay";
const VUE_SOURCE_HIDDEN_ATTR = "data-comfypencil-vue-source-hidden";
const VUE_CONTAINER_HIDDEN_ATTR = "data-comfypencil-vue-container-hidden";
const VUE_NODE_ATTR = "data-comfypencil-node";

let vueBadgeRefreshHandle = 0;
let vueBadgeObserver = null;

function getApp() {
  return window.comfyAPI?.app?.app || window.app || app || null;
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getNodeSource(node) {
  return node?.constructor?.nodeData?.nodeSource || null;
}

function isComfyPencilSource(source) {
  const candidates = [
    source?.badgeText,
    source?.displayText,
    source?.className,
    source?.type,
    source?.category,
  ].filter(Boolean);
  return candidates.some((value) => normalizeToken(value).includes("comfypencil"));
}

function isComfyPencilNode(node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (isComfyPencilSource(getNodeSource(node))) {
    return true;
  }

  const candidates = [
    node?.comfyClass,
    node?.type,
    node?.title,
    node?.constructor?.nodeData?.name,
    node?.constructor?.nodeData?.display_name,
    node?.constructor?.nodeData?.category,
    node?.constructor?.title,
    node?.constructor?.type,
    node?.constructor?.comfyClass,
  ].filter(Boolean);

  return candidates.some((value) => normalizeToken(value).includes("comfypencil"));
}

function syncSourceLabel(source) {
  if (!source || !isComfyPencilSource(source)) {
    return;
  }

  source.displayText = BADGE_TEXT;
  source.badgeText = BADGE_TEXT;
}

function styleNodeSourceBadge(node) {
  const source = getNodeSource(node);
  if (!source || !isComfyPencilSource(source)) {
    return false;
  }

  syncSourceLabel(source);

  let changed = false;
  for (const key of ["badgeColor", "badgeBgColor", "badgeBackgroundColor"]) {
    if (source[key] !== BADGE_BG) {
      source[key] = BADGE_BG;
      changed = true;
    }
  }

  for (const key of ["textColor", "badgeTextColor"]) {
    if (source[key] !== BADGE_FG) {
      source[key] = BADGE_FG;
      changed = true;
    }
  }

  return changed;
}

function styleBadgeInstance(badge, node) {
  if (!badge || typeof badge !== "object") {
    return badge;
  }

  const badgeText = normalizeToken(badge.text || "");
  if (!badgeText.includes("comfypencil") && !isComfyPencilNode(node)) {
    return badge;
  }

  badge.text = BADGE_TEXT;
  badge.fgColor = BADGE_FG;
  badge.bgColor = BADGE_BG;
  badge.cornerRadius = Math.max(5, Number(badge.cornerRadius) || 5);
  return badge;
}

function styleBadgeEntry(entry, node) {
  if (!entry) {
    return entry;
  }

  if (typeof entry === "function") {
    if (entry.__comfypencilWrappedBadge === true) {
      return entry;
    }

    const wrapped = function wrappedBadgeEntry(...args) {
      return styleBadgeInstance(entry.apply(this, args), node);
    };
    wrapped.__comfypencilWrappedBadge = true;
    return wrapped;
  }

  return styleBadgeInstance(entry, node);
}

function patchBadgeArray(node) {
  if (!Array.isArray(node?.badges) || node.badges.__comfypencilPatchedBadgeArray === true) {
    return;
  }

  for (let index = 0; index < node.badges.length; index += 1) {
    node.badges[index] = styleBadgeEntry(node.badges[index], node);
  }

  for (const methodName of ["push", "unshift"]) {
    const original = node.badges[methodName];
    if (typeof original !== "function") {
      continue;
    }

    node.badges[methodName] = function patchedBadgeAppend(...entries) {
      return original.apply(this, entries.map((entry) => styleBadgeEntry(entry, node)));
    };
  }

  const originalSplice = node.badges.splice;
  if (typeof originalSplice === "function") {
    node.badges.splice = function patchedBadgeSplice(start, deleteCount, ...entries) {
      return originalSplice.call(
        this,
        start,
        deleteCount,
        ...entries.map((entry) => styleBadgeEntry(entry, node))
      );
    };
  }

  node.badges.__comfypencilPatchedBadgeArray = true;
}

function queueRedraw(node) {
  const currentApp = getApp();
  node?.setDirtyCanvas?.(true, true);
  node?.graph?.setDirtyCanvas?.(true, true);
  currentApp?.graph?.setDirtyCanvas?.(true, true);
}

function getCurrentGraph() {
  const currentApp = getApp();
  return currentApp?.canvas?.graph || currentApp?.graph || null;
}

function resolveGraphNodeById(rawId) {
  if (rawId == null || rawId === "") {
    return null;
  }

  const graph = getCurrentGraph();
  if (!graph) {
    return null;
  }

  const numericId = Number(rawId);
  if (typeof graph.getNodeById === "function") {
    return (
      graph.getNodeById(rawId) ||
      (Number.isFinite(numericId) ? graph.getNodeById(numericId) : null) ||
      null
    );
  }

  return (
    graph?._nodes_by_id?.[rawId] ||
    (Number.isFinite(numericId) ? graph?._nodes_by_id?.[numericId] : null) ||
    null
  );
}

function ensureVueBadgeStyles() {
  if (document.getElementById(VUE_BADGE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = VUE_BADGE_STYLE_ID;
  style.textContent = `
    [${VUE_NODE_ATTR}="true"] [${VUE_BADGE_OVERLAY_ATTR}="true"] {
      position: absolute;
      top: 8px;
      right: 10px;
      z-index: 8;
      display: flex;
      align-items: center;
      min-width: max-content;
      border-radius: 6px;
      padding: 2px 7px;
      background: ${BADGE_BG};
      color: ${BADGE_FG};
      font-size: 11px;
      line-height: 1;
      pointer-events: none;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
    }
  `;
  document.head.appendChild(style);
}

function isVueSourceBadgeElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.getAttribute(VUE_BADGE_OVERLAY_ATTR) === "true") {
    return false;
  }

  const className = String(element.className || "");
  if (!className.includes("rounded-sm") || !className.includes("text-xs")) {
    return false;
  }

  return normalizeToken(element.textContent || "").includes("comfypencil");
}

function getVueSourceBadgeCandidates(nodeElement) {
  return Array.from(
    nodeElement.querySelectorAll("[class*='rounded-sm'][class*='text-xs']")
  ).filter(isVueSourceBadgeElement);
}

function setVisibilityMarker(element, attrName, hidden) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (hidden) {
    element.setAttribute(attrName, "true");
    element.style.display = "none";
    return;
  }

  if (element.getAttribute(attrName) === "true") {
    element.removeAttribute(attrName);
    element.style.display = "";
  }
}

function updateVueBadgeContainer(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const visibleBadgeCount = Array.from(container.children).filter((child) => {
    if (!(child instanceof HTMLElement)) {
      return false;
    }

    if (child.getAttribute(VUE_SOURCE_HIDDEN_ATTR) === "true") {
      return false;
    }

    const className = String(child.className || "");
    if (className.includes("border-r")) {
      return false;
    }

    return normalizeToken(child.textContent || "").length > 0;
  }).length;

  setVisibilityMarker(container, VUE_CONTAINER_HIDDEN_ATTR, visibleBadgeCount === 0);
}

function hideVueSourceBadgeCandidate(candidate) {
  setVisibilityMarker(candidate, VUE_SOURCE_HIDDEN_ATTR, true);

  const previous = candidate.previousElementSibling;
  if (previous instanceof HTMLElement && String(previous.className || "").includes("border-r")) {
    setVisibilityMarker(previous, VUE_SOURCE_HIDDEN_ATTR, true);
  }

  updateVueBadgeContainer(candidate.parentElement);
}

function restoreVueSourceBadges(nodeElement) {
  for (const element of nodeElement.querySelectorAll(`[${VUE_SOURCE_HIDDEN_ATTR}="true"]`)) {
    setVisibilityMarker(element, VUE_SOURCE_HIDDEN_ATTR, false);
  }

  for (const container of nodeElement.querySelectorAll(`[${VUE_CONTAINER_HIDDEN_ATTR}="true"]`)) {
    setVisibilityMarker(container, VUE_CONTAINER_HIDDEN_ATTR, false);
  }
}

function ensureVueOverlayBadge(nodeElement) {
  let overlay = nodeElement.querySelector(`[${VUE_BADGE_OVERLAY_ATTR}="true"]`);
  if (!(overlay instanceof HTMLElement)) {
    overlay = document.createElement("div");
    overlay.setAttribute(VUE_BADGE_OVERLAY_ATTR, "true");
    nodeElement.appendChild(overlay);
  }

  overlay.textContent = BADGE_TEXT;
  return overlay;
}

function clearVueOverlayBadge(nodeElement) {
  const overlay = nodeElement.querySelector(`[${VUE_BADGE_OVERLAY_ATTR}="true"]`);
  if (overlay instanceof HTMLElement) {
    overlay.remove();
  }
}

function applyVueBadgeTheme(nodeElement) {
  if (!(nodeElement instanceof HTMLElement)) {
    return;
  }

  const rawId = nodeElement.dataset.nodeId;
  const node = resolveGraphNodeById(rawId);
  if (!isComfyPencilNode(node)) {
    nodeElement.removeAttribute(VUE_NODE_ATTR);
    clearVueOverlayBadge(nodeElement);
    restoreVueSourceBadges(nodeElement);
    return;
  }

  nodeElement.setAttribute(VUE_NODE_ATTR, "true");
  ensureVueOverlayBadge(nodeElement);

  for (const candidate of getVueSourceBadgeCandidates(nodeElement)) {
    hideVueSourceBadgeCandidate(candidate);
  }
}

function refreshVueNodeBadges() {
  vueBadgeRefreshHandle = 0;

  if (!document.body) {
    return;
  }

  ensureVueBadgeStyles();
  for (const nodeElement of document.querySelectorAll("[data-node-id]")) {
    applyVueBadgeTheme(nodeElement);
  }
}

function scheduleVueBadgeRefresh() {
  if (vueBadgeRefreshHandle) {
    return;
  }

  vueBadgeRefreshHandle = requestAnimationFrame(() => {
    refreshVueNodeBadges();
  });
}

function ensureVueBadgeObserver() {
  if (vueBadgeObserver || typeof MutationObserver !== "function") {
    return;
  }

  const startObserver = () => {
    if (vueBadgeObserver || !document.body) {
      return;
    }

    vueBadgeObserver = new MutationObserver(() => {
      scheduleVueBadgeRefresh();
    });

    vueBadgeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleVueBadgeRefresh();
  };

  if (document.body) {
    startObserver();
    return;
  }

  requestAnimationFrame(startObserver);
}

function stopBadgeRefresh(node) {
  const timer = node?.__comfypencilBadgeRefreshTimer;
  if (!timer) {
    return;
  }

  clearInterval(timer);
  node.__comfypencilBadgeRefreshTimer = null;
}

function applyBadgeTheme(node) {
  if (!isComfyPencilNode(node)) {
    return false;
  }

  let changed = false;

  if (styleNodeSourceBadge(node)) {
    changed = true;
  }

  if (node.badgePosition !== BADGE_POSITION_TOP_RIGHT) {
    node.badgePosition = BADGE_POSITION_TOP_RIGHT;
    changed = true;
  }

  if (!Array.isArray(node.badges)) {
    node.badges = [];
    changed = true;
  }

  patchBadgeArray(node);

  for (let index = 0; index < node.badges.length; index += 1) {
    const entry = node.badges[index];
    const styled = styleBadgeEntry(entry, node);
    if (styled !== entry) {
      node.badges[index] = styled;
      changed = true;
    }
  }

  if (changed) {
    queueRedraw(node);
  }

  return changed || (Array.isArray(node.badges) && node.badges.length > 0);
}

function scheduleBadgeRefresh(node) {
  if (!isComfyPencilNode(node)) {
    return;
  }

  stopBadgeRefresh(node);

  let tries = 0;
  const tick = () => {
    tries += 1;
    const ready = applyBadgeTheme(node);
    if (ready || tries >= BADGE_MAX_RETRIES) {
      stopBadgeRefresh(node);
    }
  };

  tick();
  node.__comfypencilBadgeRefreshTimer = setInterval(tick, BADGE_REFRESH_RETRY_MS);
}

function refreshExistingNodeBadges() {
  const currentApp = getApp();
  for (const node of currentApp?.graph?._nodes || []) {
    scheduleBadgeRefresh(node);
  }
}

app.registerExtension({
  name: EXTENSION_NAME,

  setup() {
    ensureVueBadgeObserver();
    scheduleVueBadgeRefresh();
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || typeof nodeData !== "object") {
      return;
    }

    syncSourceLabel(nodeData.nodeSource);
    if (isComfyPencilSource(nodeData.nodeSource) && nodeType?.prototype) {
      nodeType.prototype.badgePosition = BADGE_POSITION_TOP_RIGHT;
    }
  },

  nodeCreated(node) {
    scheduleBadgeRefresh(node);
    scheduleVueBadgeRefresh();
  },

  afterConfigureGraph() {
    refreshExistingNodeBadges();
    scheduleVueBadgeRefresh();
  },
});
