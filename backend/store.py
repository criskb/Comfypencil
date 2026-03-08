"""Persistent document storage for ComfyPencil."""

from __future__ import annotations

import base64
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image

from .constants import API_PREFIX, DEFAULT_BACKGROUND_COLOR, DEFAULT_BACKGROUND_MODE, DEFAULT_DOCUMENT_NAME, DEFAULT_HEIGHT, DEFAULT_LAYER_NAME, DEFAULT_WIDTH, DOCUMENTS_ROOT
from .rendering import clamp_canvas_size, make_blank_rgba, metadata_only, normalize_hex_color

PROJECT_FILE_FORMAT = "comfypencil.pencilstudio"
PROJECT_FILE_VERSION = 2
SUPPORTED_PROJECT_FILE_VERSIONS = {1, 2}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_storage() -> None:
    DOCUMENTS_ROOT.mkdir(parents=True, exist_ok=True)


def _document_dir(document_id: str) -> Path:
    return DOCUMENTS_ROOT / document_id


def _metadata_path(document_id: str) -> Path:
    return _document_dir(document_id) / "document.json"


def _layers_dir(document_id: str) -> Path:
    return _document_dir(document_id) / "layers"


def _layer_path(document_id: str, layer_id: str) -> Path:
    return _layers_dir(document_id) / f"{layer_id}.png"


def _layer_material_path(document_id: str, layer_id: str) -> Path:
    return _layers_dir(document_id) / f"{layer_id}__material.png"


def _split_preview_path(document_id: str) -> Path:
    return _document_dir(document_id) / "split_preview.png"


def _new_layer_record(index: int, *, layer_id: str | None = None, name: str | None = None) -> dict[str, Any]:
    return {
        "id": layer_id or uuid4().hex,
        "name": name or (DEFAULT_LAYER_NAME if index == 0 else f"{DEFAULT_LAYER_NAME} {index + 1}"),
        "visible": True,
        "opacity": 1.0,
        "blendMode": "normal",
        "locked": False,
        "alphaLocked": False,
        "thumbnailVersion": 0,
        "updatedAt": _now_iso(),
    }


def _sanitize_layer(layer: dict[str, Any], index: int) -> dict[str, Any]:
    safe = _new_layer_record(index, layer_id=str(layer.get("id") or uuid4().hex))
    safe["name"] = str(layer.get("name") or safe["name"])[:120]
    safe["visible"] = bool(layer.get("visible", True))
    try:
        safe["opacity"] = max(0.0, min(1.0, float(layer.get("opacity", 1.0))))
    except Exception:
        safe["opacity"] = 1.0
    safe["blendMode"] = str(layer.get("blendMode") or "normal")
    if safe["blendMode"] not in {"normal", "multiply", "screen", "overlay", "soft-light", "add"}:
        safe["blendMode"] = "normal"
    safe["locked"] = bool(layer.get("locked", False))
    safe["alphaLocked"] = bool(layer.get("alphaLocked", False))
    safe["thumbnailVersion"] = int(layer.get("thumbnailVersion") or 0)
    safe["updatedAt"] = layer.get("updatedAt") or _now_iso()
    return safe


def _sanitize_document(document: dict[str, Any], *, document_id: str | None = None, revision: int = 0, created_at: str | None = None) -> dict[str, Any]:
    width = clamp_canvas_size(document.get("width"), default=DEFAULT_WIDTH)
    height = clamp_canvas_size(document.get("height"), default=DEFAULT_HEIGHT)
    layers_in = document.get("layers") or []
    layers = [_sanitize_layer(layer, index) for index, layer in enumerate(layers_in)]
    if not layers:
        layers = [_new_layer_record(0)]
    active_layer_id = document.get("activeLayerId")
    if active_layer_id not in {layer["id"] for layer in layers}:
        active_layer_id = layers[-1]["id"]

    background = document.get("background") if isinstance(document.get("background"), dict) else {}
    background_mode = str(background.get("mode") or DEFAULT_BACKGROUND_MODE)
    if background_mode not in {"transparent", "solid"}:
        background_mode = DEFAULT_BACKGROUND_MODE

    assist = document.get("assist") if isinstance(document.get("assist"), dict) else {}
    try:
        rotation = float(assist.get("rotation", 0.0))
    except Exception:
        rotation = 0.0
    rotation = max(-180.0, min(180.0, rotation))
    symmetry = str(assist.get("symmetry") or "off")
    if symmetry not in {"off", "vertical", "horizontal", "quadrant"}:
        symmetry = "off"
    try:
        stroke_constraint = int(round(float(assist.get("strokeConstraint", 0) or 0)))
    except Exception:
        stroke_constraint = 0
    if stroke_constraint not in {0, 15, 30, 45}:
        stroke_constraint = 0

    return {
        "id": str(document_id or document.get("id") or uuid4().hex),
        "previewKey": str(document.get("previewKey") or document_id or document.get("id") or ""),
        "revision": int(revision),
        "version": 1,
        "name": str(document.get("name") or DEFAULT_DOCUMENT_NAME)[:120],
        "width": width,
        "height": height,
        "createdAt": created_at or document.get("createdAt") or _now_iso(),
        "updatedAt": _now_iso(),
        "studioNodeId": str(document.get("studioNodeId") or ""),
        "activeLayerId": active_layer_id,
        "assist": {
            "rotation": rotation,
            "symmetry": symmetry,
            "strokeConstraint": stroke_constraint,
        },
        "background": {
            "mode": background_mode,
            "color": normalize_hex_color(background.get("color"), DEFAULT_BACKGROUND_COLOR),
        },
        "layers": layers,
    }


def _write_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, format="PNG", compress_level=2)


def _decode_data_url(value: str) -> bytes:
    if "," not in value:
        raise ValueError("Expected data URL")
    _, encoded = value.split(",", 1)
    return base64.b64decode(encoded)


def _encode_png_data_url(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def _materialize_asset(path: Path, payload: Any, *, width: int, height: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, Image.Image):
        _write_png(payload.resize((width, height), Image.Resampling.LANCZOS), path)
        return
    if isinstance(payload, (bytes, bytearray)):
        image = Image.open(io.BytesIO(bytes(payload))).convert("RGBA")
        _write_png(image.resize((width, height), Image.Resampling.LANCZOS), path)
        return
    if isinstance(payload, str):
        if payload.startswith("data:image/"):
            image = Image.open(io.BytesIO(_decode_data_url(payload))).convert("RGBA")
            _write_png(image.resize((width, height), Image.Resampling.LANCZOS), path)
            return
        source = Path(payload)
        if source.exists():
            image = Image.open(source).convert("RGBA")
            _write_png(image.resize((width, height), Image.Resampling.LANCZOS), path)
            return
    raise TypeError(f"Unsupported layer payload type: {type(payload)!r}")


def _materialize_payload(document_id: str, layer_id: str, payload: Any, *, width: int, height: int) -> None:
    color_payload = payload
    material_payload = None
    if isinstance(payload, dict):
        color_payload = payload.get("color", payload.get("image"))
        material_payload = payload.get("material")

    if color_payload is not None:
        _materialize_asset(_layer_path(document_id, layer_id), color_payload, width=width, height=height)
    if material_payload is not None:
        _materialize_asset(_layer_material_path(document_id, layer_id), material_payload, width=width, height=height)


def create_document(
    *,
    name: str = DEFAULT_DOCUMENT_NAME,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    background_mode: str = DEFAULT_BACKGROUND_MODE,
    background_color: str = DEFAULT_BACKGROUND_COLOR,
) -> dict[str, Any]:
    ensure_storage()
    document_id = uuid4().hex
    document = _sanitize_document(
        {
            "name": name,
            "width": width,
            "height": height,
            "background": {"mode": background_mode, "color": background_color},
            "layers": [_new_layer_record(0, name=DEFAULT_LAYER_NAME)],
        },
        document_id=document_id,
        revision=1,
    )
    blank = make_blank_rgba(document["width"], document["height"])
    _write_png(blank, _layer_path(document_id, document["layers"][0]["id"]))
    _write_png(blank, _layer_material_path(document_id, document["layers"][0]["id"]))
    save_metadata(document)
    return document


def save_metadata(document: dict[str, Any]) -> None:
    ensure_storage()
    metadata_path = _metadata_path(document["id"])
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as handle:
        json.dump(metadata_only(document), handle, indent=2, sort_keys=True)


def load_document_metadata(document_id: str) -> dict[str, Any]:
    metadata_path = _metadata_path(document_id)
    if not metadata_path.exists():
        raise FileNotFoundError(f"Document {document_id} does not exist")
    with metadata_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_document(
    document: dict[str, Any],
    layer_images: dict[str, Any] | None = None,
    layer_material_images: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_storage()
    existing = None
    try:
        existing = load_document_metadata(str(document.get("id") or ""))
    except Exception:
        existing = None

    revision = int(existing.get("revision") or 0) + 1 if existing else 1
    document_id = str(document.get("id") or (existing or {}).get("id") or uuid4().hex)
    sanitized = _sanitize_document(
        document,
        document_id=document_id,
        revision=revision,
        created_at=(existing or {}).get("createdAt"),
    )

    old_layer_ids = {layer["id"] for layer in (existing or {}).get("layers", [])}
    new_layer_ids = {layer["id"] for layer in sanitized["layers"]}

    payloads = layer_images or {}
    material_payloads = layer_material_images or {}
    for layer in sanitized["layers"]:
        payload = payloads.get(layer["id"])
        material_payload = material_payloads.get(layer["id"])
        if material_payload is not None and not isinstance(payload, dict):
            payload = {
                "color": payload,
                "material": material_payload,
            }
        target = _layer_path(document_id, layer["id"])
        material_target = _layer_material_path(document_id, layer["id"])
        if payload is not None:
            _materialize_payload(document_id, layer["id"], payload, width=sanitized["width"], height=sanitized["height"])
        elif not target.exists():
            _write_png(make_blank_rgba(sanitized["width"], sanitized["height"]), target)
        if not target.exists():
            _write_png(make_blank_rgba(sanitized["width"], sanitized["height"]), target)
        if not material_target.exists():
            _write_png(make_blank_rgba(sanitized["width"], sanitized["height"]), material_target)

    for removed_id in old_layer_ids - new_layer_ids:
        path = _layer_path(document_id, removed_id)
        if path.exists():
            path.unlink()
        material_path = _layer_material_path(document_id, removed_id)
        if material_path.exists():
            material_path.unlink()

    save_metadata(sanitized)
    return sanitized


def load_runtime_document(document_id: str) -> dict[str, Any]:
    metadata = load_document_metadata(document_id)
    runtime = metadata_only(metadata)
    runtime["layers"] = []
    for layer in metadata.get("layers", []):
        layer_id = layer["id"]
        path = _layer_path(document_id, layer_id)
        material_path = _layer_material_path(document_id, layer_id)
        if path.exists():
            image = Image.open(path).convert("RGBA")
        else:
            image = make_blank_rgba(runtime["width"], runtime["height"])
        if material_path.exists():
            material_image = Image.open(material_path).convert("RGBA")
        else:
            material_image = make_blank_rgba(runtime["width"], runtime["height"])
        runtime["layers"].append({**layer, "image": image, "materialImage": material_image})
    return runtime


def save_runtime_document(document: dict[str, Any]) -> dict[str, Any]:
    layer_images = {}
    for layer in document.get("layers", []):
        image = layer.get("image")
        if isinstance(image, Image.Image):
            layer_payload: dict[str, Any] = {"color": image}
            material_image = layer.get("materialImage")
            if isinstance(material_image, Image.Image):
                layer_payload["material"] = material_image
            layer_images[str(layer.get("id"))] = layer_payload
    saved = save_document(document, layer_images=layer_images)
    return load_runtime_document(saved["id"])


def export_project_bundle(document_id: str) -> dict[str, Any]:
    metadata = load_document_metadata(document_id)
    bundle_document = metadata_only(metadata)
    bundle_document["id"] = ""
    bundle_document["revision"] = 0
    bundle_document["previewKey"] = ""
    bundle_document["studioNodeId"] = ""
    layer_images: dict[str, str] = {}
    layer_material_images: dict[str, str] = {}
    for layer in bundle_document.get("layers", []):
        layer_id = str(layer.get("id") or "").strip()
        if not layer_id:
            continue
        path = _layer_path(document_id, layer_id)
        material_path = _layer_material_path(document_id, layer_id)
        if path.exists():
            layer_images[layer_id] = _encode_png_data_url(path)
        if material_path.exists():
            layer_material_images[layer_id] = _encode_png_data_url(material_path)
    return {
        "format": PROJECT_FILE_FORMAT,
        "version": PROJECT_FILE_VERSION,
        "exportedAt": _now_iso(),
        "document": bundle_document,
        "layerImages": layer_images,
        "layerMaterialImages": layer_material_images,
    }


def import_project_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(bundle, dict):
        raise TypeError("Project bundle must be an object.")
    if str(bundle.get("format") or "") != PROJECT_FILE_FORMAT:
        raise ValueError("Unsupported project format.")
    if int(bundle.get("version") or 0) not in SUPPORTED_PROJECT_FILE_VERSIONS:
        raise ValueError("Unsupported project version.")

    document = bundle.get("document")
    if not isinstance(document, dict):
        raise ValueError("Project bundle is missing a document payload.")
    layer_images = bundle.get("layerImages") or {}
    if not isinstance(layer_images, dict):
        raise ValueError("Project bundle layer images must be an object.")
    layer_material_images = bundle.get("layerMaterialImages") or {}
    if not isinstance(layer_material_images, dict):
        raise ValueError("Project bundle material images must be an object.")

    document_id = uuid4().hex
    sanitized = _sanitize_document(
        {
            **document,
            "id": document_id,
            "revision": 1,
            "previewKey": "",
            "studioNodeId": "",
        },
        document_id=document_id,
        revision=1,
    )

    for layer in sanitized["layers"]:
        payload = layer_images.get(layer["id"])
        material_payload = layer_material_images.get(layer["id"])
        if payload is not None:
            _materialize_asset(_layer_path(document_id, layer["id"]), payload, width=sanitized["width"], height=sanitized["height"])
        else:
            _write_png(make_blank_rgba(sanitized["width"], sanitized["height"]), _layer_path(document_id, layer["id"]))
        if material_payload is not None:
            _materialize_asset(_layer_material_path(document_id, layer["id"]), material_payload, width=sanitized["width"], height=sanitized["height"])
        else:
            _write_png(make_blank_rgba(sanitized["width"], sanitized["height"]), _layer_material_path(document_id, layer["id"]))

    save_metadata(sanitized)
    return sanitized


def export_document(document: dict[str, Any]) -> dict[str, Any]:
    exported = metadata_only(document)
    document_id = exported.get("id")
    revision = exported.get("revision") or 0
    if document_id:
        for layer in exported["layers"]:
            layer["imageUrl"] = f"{API_PREFIX}/documents/{document_id}/layers/{layer['id']}.png?rev={revision}"
            layer["materialImageUrl"] = f"{API_PREFIX}/documents/{document_id}/layers/{layer['id']}/material.png?rev={revision}"
    return exported


def layer_image_path(document_id: str, layer_id: str) -> Path:
    return _layer_path(document_id, layer_id)


def layer_material_path(document_id: str, layer_id: str) -> Path:
    return _layer_material_path(document_id, layer_id)


def save_split_preview(document_id: str, image: Image.Image) -> Path:
    ensure_storage()
    path = _split_preview_path(document_id)
    _write_png(image.convert("RGBA"), path)
    return path


def split_preview_image_path(document_id: str) -> Path:
    return _split_preview_path(document_id)
