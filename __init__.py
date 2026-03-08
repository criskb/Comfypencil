"""ComfyPencil package entrypoint."""

from __future__ import annotations

from .backend.nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

try:
    from .backend import routes as _routes  # noqa: F401
except Exception as exc:  # pragma: no cover - safe import fallback outside ComfyUI
    print(f"[ComfyPencil] Route registration skipped: {exc}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
