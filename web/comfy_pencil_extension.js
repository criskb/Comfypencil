import { app } from "/scripts/app.js";

import { COMMANDS, EXTENSION_NAME, SIDEBAR_TAB_ID, STUDIO_NODE_ID } from "./studio/constants.js";
import { ComfyPencilStudioOverlay } from "./studio/studio-app.js";

const SIDEBAR_ICON_STYLE_ID = "comfypencil-sidebar-icon-style";
const BRUSH_ICON_URL = new URL("./icons/brush.svg", import.meta.url).href;

let overlay = null;

function getOverlay() {
  if (!overlay) {
    overlay = new ComfyPencilStudioOverlay();
  }
  return overlay;
}

function hideWidget(widget) {
  if (!widget) {
    return;
  }
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
}

function isStudioNode(node) {
  return node?.comfyClass === STUDIO_NODE_ID || node?.type === STUDIO_NODE_ID;
}

function getStudioNodes() {
  return (app.graph?._nodes || []).filter((node) => isStudioNode(node));
}

function getSelectedStudioNode() {
  const selectedNodes = Object.values(app.canvas?.selected_nodes || {});
  return selectedNodes.find((node) => isStudioNode(node)) || getStudioNodes()[0] || null;
}

function getAutoSaveMs() {
  return Number(app.ui?.settings?.getSettingValue?.("ComfyPencil.Settings.AutoSaveMs") || 900);
}

async function openStudioForNode(node) {
  if (!node) {
    alert("Select a Comfy Pencil Studio node first.");
    return;
  }
  await getOverlay().openForNode(node, {
    autoSaveMs: getAutoSaveMs(),
  });
}

function decorateStudioNode(node) {
  if (!node || node.__comfypencilDecorated) {
    return;
  }
  node.__comfypencilDecorated = true;

  hideWidget(node.widgets?.find((widget) => widget.name === "document_id"));
  hideWidget(node.widgets?.find((widget) => widget.name === "revision"));
  hideWidget(node.widgets?.find((widget) => widget.name === "run_token"));

  const openButton = node.addWidget("button", "Open Studio", null, () => {
    openStudioForNode(node).catch((error) => {
      console.error("[ComfyPencil] Failed to open studio.", error);
    });
  });
  openButton.computeSize = openButton.computeSize?.bind(openButton) || (() => [0, 28]);
}

function renderSidebarLauncher(element) {
  if (typeof element.__comfypencilCleanup === "function") {
    element.__comfypencilCleanup();
  }

  const container = document.createElement("div");
  container.className = "cp-sidebar-launcher";
  element.replaceChildren(container);

  const headerCard = document.createElement("div");
  headerCard.className = "cp-sidebar-launcher__card";
  headerCard.innerHTML = `
    <strong>Comfy Pencil</strong>
    <div style="margin-top:0.55rem; line-height:1.45;">
      A layered paint studio for workflow nodes. Open the selected node or jump straight to any studio already in the graph.
    </div>
  `;

  const launchSelected = document.createElement("button");
  launchSelected.type = "button";
  launchSelected.className = "cp-button cp-primary";
  launchSelected.textContent = "Open Selected Studio";
  launchSelected.addEventListener("click", () => {
    openStudioForNode(getSelectedStudioNode()).catch((error) => console.error(error));
  });
  headerCard.appendChild(document.createElement("div")).appendChild(launchSelected);
  container.appendChild(headerCard);

  const nodesCard = document.createElement("div");
  nodesCard.className = "cp-sidebar-launcher__card";
  const title = document.createElement("div");
  title.style.marginBottom = "0.7rem";
  title.style.fontWeight = "700";
  title.textContent = "Studio Nodes";
  const nodesList = document.createElement("div");
  nodesList.className = "cp-sidebar-launcher__nodes";
  nodesCard.append(title, nodesList);
  container.appendChild(nodesCard);

  const renderNodes = () => {
    nodesList.replaceChildren();
    const nodes = getStudioNodes();
    if (!nodes.length) {
      const empty = document.createElement("div");
      empty.textContent = "No Comfy Pencil Studio nodes in this graph yet.";
      empty.style.opacity = "0.7";
      nodesList.appendChild(empty);
      return;
    }

    nodes.forEach((node) => {
      const row = document.createElement("div");
      row.className = "cp-sidebar-launcher__node";
      const label = document.createElement("div");
      const titleText = node.title || "Comfy Pencil Studio";
      label.innerHTML = `<strong>${titleText}</strong><div style="opacity:0.7; font-size:0.82rem;">#${node.id}</div>`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cp-button";
      button.textContent = "Open";
      button.addEventListener("click", () => {
        app.canvas?.selectNode?.(node, false);
        openStudioForNode(node).catch((error) => console.error(error));
      });
      row.append(label, button);
      nodesList.appendChild(row);
    });
  };

  renderNodes();
  const interval = window.setInterval(renderNodes, 1200);
  element.__comfypencilCleanup = () => window.clearInterval(interval);
}

function ensureSidebarIconStyles() {
  if (document.getElementById(SIDEBAR_ICON_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = SIDEBAR_ICON_STYLE_ID;
  style.textContent = `
    .${SIDEBAR_TAB_ID}-tab-button .side-bar-button-icon {
      width: 1.1em;
      height: 1.1em;
      min-width: 1.1em;
      min-height: 1.1em;
      display: inline-block;
      flex: 0 0 auto;
      font-size: 0;
      line-height: 0;
      background-color: currentColor;
      -webkit-mask-image: url("${BRUSH_ICON_URL}");
      mask-image: url("${BRUSH_ICON_URL}");
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
      -webkit-mask-size: contain;
      mask-size: contain;
    }
  `;
  document.head.appendChild(style);
}

function registerSidebarTab() {
  const register = app.extensionManager?.registerSidebarTab;
  if (typeof register !== "function") {
    console.warn("[ComfyPencil] Sidebar tabs are unavailable on this frontend build.");
    return;
  }

  ensureSidebarIconStyles();
  register({
    id: SIDEBAR_TAB_ID,
    title: "Comfy Pencil",
    tooltip: "Open Comfy Pencil studio",
    type: "custom",
    icon: "",
    render: renderSidebarLauncher,
  });
}

app.registerExtension({
  name: EXTENSION_NAME,

  settings: [
    {
      id: "ComfyPencil.Settings.AutoSaveMs",
      name: "Studio autosave delay",
      type: "slider",
      attrs: { min: 250, max: 3000, step: 50 },
      defaultValue: 900,
      category: ["Comfy Pencil", "Studio", "Autosave"],
    },
    {
      id: "ComfyPencil.Settings.ShowNodeButton",
      name: "Show Open Studio button on nodes",
      type: "boolean",
      defaultValue: true,
      category: ["Comfy Pencil", "Studio", "Node UI"],
    },
  ],

  commands: [
    {
      id: COMMANDS.OPEN_SELECTED,
      label: "Comfy Pencil: Open Selected Studio",
      icon: "pi pi-pencil",
      function: () => openStudioForNode(getSelectedStudioNode()),
    },
    {
      id: COMMANDS.SAVE_ACTIVE,
      label: "Comfy Pencil: Save Active Studio",
      icon: "pi pi-save",
      function: () => getOverlay().saveNow({ force: true }),
    },
  ],

  menuCommands: [
    {
      path: ["Extensions", "Comfy Pencil"],
      commands: [COMMANDS.OPEN_SELECTED, COMMANDS.SAVE_ACTIVE],
    },
  ],

  async setup() {
    registerSidebarTab();
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== STUDIO_NODE_ID) {
      return;
    }

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function onNodeCreatedPatched() {
      if (originalOnNodeCreated) {
        originalOnNodeCreated.apply(this, arguments);
      }
      if (app.ui?.settings?.getSettingValue?.("ComfyPencil.Settings.ShowNodeButton") !== false) {
        decorateStudioNode(this);
      }
    };
  },

  async nodeCreated(node) {
    if (!isStudioNode(node)) {
      return;
    }
    if (app.ui?.settings?.getSettingValue?.("ComfyPencil.Settings.ShowNodeButton") !== false) {
      decorateStudioNode(node);
    }
  },

  getSelectionToolboxCommands(item) {
    if (isStudioNode(item)) {
      return [COMMANDS.OPEN_SELECTED];
    }
    return [];
  },
});
