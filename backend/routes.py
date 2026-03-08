"""HTTP routes for the ComfyPencil frontend studio."""

from __future__ import annotations

import json
import re

try:
    from aiohttp import web  # type: ignore
except Exception:  # pragma: no cover - local import fallback
    web = None

try:
    from server import PromptServer  # type: ignore
except Exception:  # pragma: no cover - local import fallback
    PromptServer = None

from .constants import API_PREFIX, DEFAULT_BACKGROUND_COLOR, DEFAULT_BACKGROUND_MODE, DEFAULT_DOCUMENT_NAME, DEFAULT_HEIGHT, DEFAULT_WIDTH
from .store import (
    create_document,
    export_document,
    export_project_bundle,
    import_project_bundle,
    layer_image_path,
    layer_material_path,
    load_document_metadata,
    load_runtime_document,
    save_document,
    split_preview_image_path,
)


def _json_error(message: str, *, status: int = 400) -> "web.Response":
    return web.json_response({"error": message}, status=status)


def _project_filename(name: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(name or "untitled_sketch")).strip("._-") or "untitled_sketch"
    return f"{stem}.pencilstudio"


async def _read_json(request) -> dict:
    try:
        payload = await request.json()
    except Exception as exc:
        raise ValueError("Request body must be JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Request JSON must be an object.")
    return payload


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get(f"{API_PREFIX}/health")
    async def comfypencil_health(_request):
        return web.json_response({"ok": True})


    @PromptServer.instance.routes.post(f"{API_PREFIX}/documents")
    async def comfypencil_create_document(request):
        try:
            payload = await _read_json(request)
        except ValueError as exc:
            return _json_error(str(exc))

        document = create_document(
            name=str(payload.get("name") or DEFAULT_DOCUMENT_NAME),
            width=int(payload.get("width") or DEFAULT_WIDTH),
            height=int(payload.get("height") or DEFAULT_HEIGHT),
            background_mode=str(payload.get("backgroundMode") or DEFAULT_BACKGROUND_MODE),
            background_color=str(payload.get("backgroundColor") or DEFAULT_BACKGROUND_COLOR),
        )
        return web.json_response({"document": export_document(document)})


    @PromptServer.instance.routes.get(f"{API_PREFIX}/documents/{{document_id}}")
    async def comfypencil_get_document(request):
        document_id = str(request.match_info["document_id"])
        try:
            document = load_document_metadata(document_id)
        except FileNotFoundError:
            return _json_error("Document not found.", status=404)
        return web.json_response({"document": export_document(document)})


    @PromptServer.instance.routes.put(f"{API_PREFIX}/documents/{{document_id}}")
    async def comfypencil_save_document(request):
        document_id = str(request.match_info["document_id"])
        try:
            payload = await _read_json(request)
        except ValueError as exc:
            return _json_error(str(exc))

        document = payload.get("document")
        if not isinstance(document, dict):
            return _json_error("`document` is required.")

        layer_images = payload.get("layerImages") or {}
        if not isinstance(layer_images, dict):
            return _json_error("`layerImages` must be an object when provided.")
        layer_material_images = payload.get("layerMaterialImages") or {}
        if not isinstance(layer_material_images, dict):
            return _json_error("`layerMaterialImages` must be an object when provided.")

        document["id"] = document_id
        try:
            saved = save_document(
                document,
                layer_images=layer_images,
                layer_material_images=layer_material_images,
            )
        except Exception as exc:
            return _json_error(f"Failed to save document: {exc}", status=500)
        return web.json_response({"document": export_document(saved)})


    @PromptServer.instance.routes.get(f"{API_PREFIX}/documents/{{document_id}}/project")
    async def comfypencil_export_project(request):
        document_id = str(request.match_info["document_id"])
        try:
            project = export_project_bundle(document_id)
        except FileNotFoundError:
            return _json_error("Document not found.", status=404)
        filename = _project_filename(project.get("document", {}).get("name") or "untitled_sketch")
        return web.json_response(
            {"project": project},
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


    @PromptServer.instance.routes.post(f"{API_PREFIX}/projects/import")
    async def comfypencil_import_project(request):
        try:
            payload = await _read_json(request)
        except ValueError as exc:
            return _json_error(str(exc))

        project = payload.get("project")
        if not isinstance(project, dict):
            return _json_error("`project` is required.")

        try:
            imported = import_project_bundle(project)
        except ValueError as exc:
            return _json_error(str(exc))
        except Exception as exc:
            return _json_error(f"Failed to import project: {exc}", status=500)
        return web.json_response({"document": export_document(imported)})


    @PromptServer.instance.routes.get(f"{API_PREFIX}/documents/{{document_id}}/layers/{{layer_id}}.png")
    async def comfypencil_get_layer_image(request):
        document_id = str(request.match_info["document_id"])
        layer_id = str(request.match_info["layer_id"])
        path = layer_image_path(document_id, layer_id)
        if not path.exists():
            return _json_error("Layer image not found.", status=404)
        return web.Response(body=path.read_bytes(), content_type="image/png")


    @PromptServer.instance.routes.get(f"{API_PREFIX}/documents/{{document_id}}/layers/{{layer_id}}/material.png")
    async def comfypencil_get_layer_material_image(request):
        document_id = str(request.match_info["document_id"])
        layer_id = str(request.match_info["layer_id"])
        path = layer_material_path(document_id, layer_id)
        if not path.exists():
            return _json_error("Layer material image not found.", status=404)
        return web.Response(body=path.read_bytes(), content_type="image/png")


    @PromptServer.instance.routes.get(f"{API_PREFIX}/documents/{{document_id}}/split-preview.png")
    async def comfypencil_get_split_preview(request):
        document_id = str(request.match_info["document_id"])
        path = split_preview_image_path(document_id)
        if not path.exists():
            return _json_error("Split preview not found.", status=404)
        return web.Response(body=path.read_bytes(), content_type="image/png")
