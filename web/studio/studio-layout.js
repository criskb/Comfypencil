function clampPosition(value, min, max) {
  return Math.min(Math.max(min, value), max);
}

export const SPLIT_ARTBOARD_EDGE_PADDING = 22;
export const SPLIT_ARTBOARD_GAP = 32;
export const SPLIT_ARTBOARD_VERTICAL_GAP = 10;
export const SPLIT_ARTBOARD_COMPACT_WIDTH = 320;
export const SPLIT_ARTBOARD_MICRO_WIDTH = 250;
export const SPLIT_ARTBOARD_MAX_WIDTH = 420;
export const SPLIT_ARTBOARD_MIN_WIDTH = 220;
export const SPLIT_ARTBOARD_TOP_PADDING = 96;
export const SPLIT_ARTBOARD_BOTTOM_PADDING = 116;
export const SPLIT_ARTBOARD_RESERVE_BREAKPOINT = 860;

export function getShellBounds(inspectorElement) {
  return inspectorElement?.getBoundingClientRect() || {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function clampFreePanelPosition({ left, top, width, height, shellBounds }) {
  return {
    left: clampPosition(left, 12, Math.max(12, shellBounds.width - width - 12)),
    top: clampPosition(top, 72, Math.max(72, shellBounds.height - height - 12)),
  };
}

export function getDefaultPanelAnchor(panelName, panelButtons) {
  return {
    brushLibrary: {
      anchor: panelButtons.brushLibrary,
      align: "end",
      offsetX: 0,
      offsetY: 14,
    },
    color: {
      anchor: panelButtons.color,
      align: "end",
      offsetX: -6,
      offsetY: 14,
    },
    layers: {
      anchor: panelButtons.layers,
      align: "end",
      offsetX: 0,
      offsetY: 14,
    },
    document: {
      anchor: panelButtons.document,
      align: "end",
      offsetX: 0,
      offsetY: 14,
    },
  }[panelName];
}

export function resolveAnchoredPanelPosition({
  panelName,
  panel,
  panelButtons,
  shellBounds,
}) {
  const anchorConfig = getDefaultPanelAnchor(panelName, panelButtons);
  if (!anchorConfig?.anchor) {
    return null;
  }

  const bounds = anchorConfig.anchor.getBoundingClientRect();
  const width = panel.offsetWidth || panel.getBoundingClientRect().width || 252;
  const height = panel.offsetHeight || panel.getBoundingClientRect().height || 240;

  let left = bounds.left;
  if (anchorConfig.align === "center") {
    left = bounds.left + (bounds.width / 2) - (width / 2);
  } else if (anchorConfig.align === "end") {
    left = bounds.right - width;
  }
  left += anchorConfig.offsetX || 0;

  const top = bounds.bottom + (anchorConfig.offsetY || 0);
  return clampFreePanelPosition({
    left: left - shellBounds.left,
    top: top - shellBounds.top,
    width,
    height,
    shellBounds,
  });
}

export function computeSplitArtboardLayout({
  document,
  stageWidth,
  stageHeight,
}) {
  if (!document || !stageWidth || !stageHeight) {
    return null;
  }

  const aspect = Math.max(0.2, Number(document.width || 1) / Math.max(1, Number(document.height || 1)));
  const maxWidth = Math.min(
    SPLIT_ARTBOARD_MAX_WIDTH,
    Math.max(SPLIT_ARTBOARD_MIN_WIDTH, Math.round(stageWidth * 0.34)),
  );
  const minWidth = Math.min(maxWidth, Math.max(180, Math.round(stageWidth * 0.22)));
  const maxHeight = Math.max(180, stageHeight - SPLIT_ARTBOARD_TOP_PADDING - SPLIT_ARTBOARD_BOTTOM_PADDING);

  let boardWidth = maxWidth;
  let boardHeight = boardWidth / aspect;
  if (boardHeight > maxHeight) {
    boardHeight = maxHeight;
    boardWidth = boardHeight * aspect;
  }
  if (boardWidth < minWidth) {
    boardWidth = minWidth;
    boardHeight = Math.min(maxHeight, boardWidth / aspect);
  }

  boardWidth = Math.round(Math.min(maxWidth, Math.max(minWidth, boardWidth)));
  boardHeight = Math.round(Math.min(maxHeight, Math.max(140, boardHeight)));
  const left = Math.max(
    SPLIT_ARTBOARD_EDGE_PADDING,
    Math.round(stageWidth - boardWidth - SPLIT_ARTBOARD_EDGE_PADDING),
  );
  const top = clampPosition(
    Math.round((stageHeight - boardHeight) / 2),
    SPLIT_ARTBOARD_TOP_PADDING,
    Math.max(SPLIT_ARTBOARD_TOP_PADDING, stageHeight - boardHeight - SPLIT_ARTBOARD_BOTTOM_PADDING),
  );
  const reserveWidth = stageWidth >= SPLIT_ARTBOARD_RESERVE_BREAKPOINT
    ? Math.max(0, boardWidth + SPLIT_ARTBOARD_GAP + SPLIT_ARTBOARD_EDGE_PADDING)
    : 0;

  return {
    left,
    top,
    width: boardWidth,
    height: boardHeight,
    boardHeight,
    reserveWidth,
    compact: boardWidth < SPLIT_ARTBOARD_COMPACT_WIDTH,
    micro: boardWidth < SPLIT_ARTBOARD_MICRO_WIDTH,
    side: "right",
  };
}
