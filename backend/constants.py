"""Shared constants for ComfyPencil."""

from __future__ import annotations

import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = Path(os.getenv("COMFYPENCIL_DATA_DIR", PACKAGE_ROOT / "data"))
DOCUMENTS_ROOT = DATA_ROOT / "documents"

API_PREFIX = "/comfypencil"
CATEGORY_ROOT = "comfypencil"
DOCUMENT_DATA_TYPE = "PENCIL_DOCUMENT"

DEFAULT_DOCUMENT_NAME = "Untitled Sketch"
DEFAULT_LAYER_NAME = "Layer 1"
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
MIN_CANVAS_SIZE = 64
MAX_CANVAS_SIZE = 4096

DEFAULT_BACKGROUND_MODE = "transparent"
DEFAULT_BACKGROUND_COLOR = "#ffffff"
BACKGROUND_MODES = ("transparent", "solid")

BLEND_MODES = ("normal", "multiply", "screen", "overlay", "soft-light", "add")

STUDIO_NODE_ID = "ComfyPencilStudio"
PREVIEW_RECEIVER_NODE_ID = "ComfyPencilReceivePreview"
IMPORT_NODE_ID = "ComfyPencilImportLayer"
RENDER_NODE_ID = "ComfyPencilRenderDocument"
EXTRACT_NODE_ID = "ComfyPencilExtractLayer"
