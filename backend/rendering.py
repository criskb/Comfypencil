"""Rendering helpers for ComfyPencil documents."""

from __future__ import annotations

import copy
import json
from io import BytesIO
from typing import Any
from uuid import uuid4

import numpy as np
import torch
from PIL import Image

from .constants import (
    BLEND_MODES,
    DEFAULT_BACKGROUND_COLOR,
    DEFAULT_BACKGROUND_MODE,
    DEFAULT_DOCUMENT_NAME,
    DEFAULT_HEIGHT,
    DEFAULT_LAYER_NAME,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_SECONDARY_COLOR,
    DEFAULT_WIDTH,
    MAX_CANVAS_SIZE,
    MIN_CANVAS_SIZE,
)


def clamp_canvas_size(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    parsed = max(MIN_CANVAS_SIZE, parsed)
    parsed = min(MAX_CANVAS_SIZE, parsed)
    return parsed


def normalize_hex_color(value: Any, default: str = DEFAULT_BACKGROUND_COLOR) -> str:
    if not isinstance(value, str):
        return default
    text = value.strip()
    if not text:
        return default
    if not text.startswith("#"):
        text = f"#{text}"
    text = text[:7]
    if len(text) != 7:
        return default
    try:
        int(text[1:], 16)
    except ValueError:
        return default
    return text.lower()


def rgba_from_hex(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    normalized = normalize_hex_color(value)
    return (
        int(normalized[1:3], 16),
        int(normalized[3:5], 16),
        int(normalized[5:7], 16),
        int(alpha),
    )


def make_blank_rgba(width: int, height: int) -> Image.Image:
    return Image.new("RGBA", (width, height), (0, 0, 0, 0))


def tensor_to_pil_rgb(image: torch.Tensor | None, *, width: int | None = None, height: int | None = None) -> Image.Image | None:
    if image is None:
        return None

    tensor = image.detach().cpu().float()
    if tensor.ndim == 4:
        tensor = tensor[0]
    if tensor.ndim != 3:
        raise ValueError(f"Expected image tensor with 3 or 4 dims, got {tuple(tensor.shape)}")

    if tensor.shape[-1] not in (3, 4):
        raise ValueError(f"Expected image channel-last tensor, got {tuple(tensor.shape)}")

    array = (tensor[..., :3].clamp(0.0, 1.0).numpy() * 255.0).astype(np.uint8)
    image_pil = Image.fromarray(array, mode="RGB")
    if width and height and image_pil.size != (width, height):
        image_pil = image_pil.resize((width, height), Image.Resampling.LANCZOS)
    return image_pil


def mask_to_pil(mask: torch.Tensor | None, *, width: int | None = None, height: int | None = None) -> Image.Image | None:
    if mask is None:
        return None

    tensor = mask.detach().cpu().float()
    if tensor.ndim == 3:
        tensor = tensor[0]
    if tensor.ndim != 2:
        raise ValueError(f"Expected mask tensor with 2 or 3 dims, got {tuple(tensor.shape)}")

    array = (tensor.clamp(0.0, 1.0).numpy() * 255.0).astype(np.uint8)
    mask_pil = Image.fromarray(array, mode="L")
    if width and height and mask_pil.size != (width, height):
        mask_pil = mask_pil.resize((width, height), Image.Resampling.LANCZOS)
    return mask_pil


def pil_to_image_tensor(image: Image.Image) -> torch.Tensor:
    array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(array)[None, ...]


def pil_to_mask_tensor(mask: Image.Image) -> torch.Tensor:
    array = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    return torch.from_numpy(array)[None, ...]


def image_and_mask_to_rgba(
    image: torch.Tensor,
    mask: torch.Tensor | None = None,
    *,
    width: int | None = None,
    height: int | None = None,
) -> Image.Image:
    base = tensor_to_pil_rgb(image, width=width, height=height)
    if base is None:
        raise ValueError("image is required")
    rgba = base.convert("RGBA")
    alpha = mask_to_pil(mask, width=rgba.width, height=rgba.height)
    if alpha is not None:
        rgba.putalpha(alpha)
    return rgba


def _encode_png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", compress_level=2)
    return buffer.getvalue()


def clone_runtime_document(document: dict[str, Any]) -> dict[str, Any]:
    cloned = {
        key: value
        for key, value in document.items()
        if key != "layers"
    }
    layers = []
    for layer in document.get("layers", []):
        layer_copy = {key: value for key, value in layer.items()}
        image = layer_copy.get("image")
        if isinstance(image, Image.Image):
            layer_copy["image"] = image.copy()
        material_image = layer_copy.get("materialImage")
        if isinstance(material_image, Image.Image):
            layer_copy["materialImage"] = material_image.copy()
        layers.append(layer_copy)
    cloned["layers"] = layers
    return cloned


def metadata_only(document: dict[str, Any]) -> dict[str, Any]:
    assist = document.get("assist") if isinstance(document.get("assist"), dict) else {}
    try:
        rotation = float(assist.get("rotation", 0.0))
    except Exception:
        rotation = 0.0
    rotation = float(np.clip(rotation, -180.0, 180.0))
    symmetry = str(assist.get("symmetry") or "off")
    if symmetry not in {"off", "vertical", "horizontal", "quadrant"}:
        symmetry = "off"
    try:
        stroke_constraint = int(round(float(assist.get("strokeConstraint", 0) or 0)))
    except Exception:
        stroke_constraint = 0
    if stroke_constraint not in {0, 15, 30, 45}:
        stroke_constraint = 0
    paint = document.get("paint") if isinstance(document.get("paint"), dict) else {}

    clean = {
        "id": document.get("id"),
        "previewKey": str(document.get("previewKey") or document.get("id") or ""),
        "revision": int(document.get("revision") or 0),
        "version": int(document.get("version") or 1),
        "name": str(document.get("name") or DEFAULT_DOCUMENT_NAME),
        "width": clamp_canvas_size(document.get("width"), default=DEFAULT_WIDTH),
        "height": clamp_canvas_size(document.get("height"), default=DEFAULT_HEIGHT),
        "createdAt": document.get("createdAt"),
        "updatedAt": document.get("updatedAt"),
        "studioNodeId": str(document.get("studioNodeId") or ""),
        "activeLayerId": document.get("activeLayerId"),
        "assist": {
            "rotation": rotation,
            "symmetry": symmetry,
            "strokeConstraint": stroke_constraint,
        },
        "paint": {
            "primaryColor": normalize_hex_color(paint.get("primaryColor"), DEFAULT_PRIMARY_COLOR),
            "secondaryColor": normalize_hex_color(paint.get("secondaryColor"), DEFAULT_SECONDARY_COLOR),
        },
        "background": {
            "mode": (
                document.get("background", {}).get("mode")
                if isinstance(document.get("background"), dict)
                else DEFAULT_BACKGROUND_MODE
            ),
            "color": normalize_hex_color(
                document.get("background", {}).get("color")
                if isinstance(document.get("background"), dict)
                else DEFAULT_BACKGROUND_COLOR
            ),
        },
        "layers": [],
    }

    if clean["background"]["mode"] not in {DEFAULT_BACKGROUND_MODE, "solid"}:
        clean["background"]["mode"] = DEFAULT_BACKGROUND_MODE

    for index, layer in enumerate(document.get("layers", [])):
        layer_id = str(layer.get("id") or f"layer_{index + 1}")
        clean["layers"].append(
            {
                "id": layer_id,
                "name": str(layer.get("name") or f"{DEFAULT_LAYER_NAME} {index + 1}"),
                "visible": bool(layer.get("visible", True)),
                "opacity": float(np.clip(float(layer.get("opacity", 1.0)), 0.0, 1.0)),
                "blendMode": (
                    str(layer.get("blendMode") or "normal")
                    if str(layer.get("blendMode") or "normal") in BLEND_MODES
                    else "normal"
                ),
                "locked": bool(layer.get("locked", False)),
                "alphaLocked": bool(layer.get("alphaLocked", False)),
                "thumbnailVersion": int(layer.get("thumbnailVersion") or 0),
                "updatedAt": layer.get("updatedAt"),
            }
        )

    if not clean["layers"]:
        clean["layers"] = [
            {
                "id": "layer_1",
                "name": DEFAULT_LAYER_NAME,
                "visible": True,
                "opacity": 1.0,
                "blendMode": "normal",
                "locked": False,
                "alphaLocked": False,
                "thumbnailVersion": 0,
                "updatedAt": None,
            }
        ]

    layer_ids = {layer["id"] for layer in clean["layers"]}
    if clean["activeLayerId"] not in layer_ids:
        clean["activeLayerId"] = clean["layers"][-1]["id"]
    return clean


def document_summary_json(document: dict[str, Any]) -> str:
    summary = metadata_only(document)
    summary["layerCount"] = len(summary["layers"])
    return json.dumps(summary, indent=2, sort_keys=True)


def _blend_rgb(dst: np.ndarray, src: np.ndarray, mode: str) -> np.ndarray:
    if mode == "multiply":
        return dst * src
    if mode == "screen":
        return 1.0 - (1.0 - dst) * (1.0 - src)
    if mode == "overlay":
        return np.where(dst <= 0.5, 2.0 * dst * src, 1.0 - 2.0 * (1.0 - dst) * (1.0 - src))
    if mode == "soft-light":
        return (1.0 - 2.0 * src) * np.square(dst) + 2.0 * src * dst
    if mode == "add":
        return np.clip(dst + src, 0.0, 1.0)
    return src


def _alpha_composite(dst_rgba: np.ndarray, src_rgba: np.ndarray, opacity: float, mode: str) -> np.ndarray:
    src = np.clip(src_rgba.copy(), 0.0, 1.0)
    dst = np.clip(dst_rgba.copy(), 0.0, 1.0)
    src[..., 3:4] *= float(np.clip(opacity, 0.0, 1.0))

    sa = src[..., 3:4]
    da = dst[..., 3:4]
    src_rgb = src[..., :3]
    dst_rgb = dst[..., :3]

    blended_rgb = _blend_rgb(dst_rgb, src_rgb, mode)
    out_a = sa + da * (1.0 - sa)
    numerator = ((1.0 - sa) * da * dst_rgb) + ((1.0 - da) * sa * src_rgb) + (da * sa * blended_rgb)
    out_rgb = np.divide(numerator, np.clip(out_a, 1e-6, 1.0), out=np.zeros_like(numerator), where=out_a > 0)
    return np.concatenate([out_rgb, out_a], axis=-1)


def _resize_for_document(image: Image.Image, width: int, height: int, resize_mode: str) -> Image.Image:
    if image.size == (width, height):
        return image

    if resize_mode == "stretch":
        return image.resize((width, height), Image.Resampling.LANCZOS)

    if resize_mode == "center":
        canvas = make_blank_rgba(width, height)
        offset = ((width - image.width) // 2, (height - image.height) // 2)
        canvas.alpha_composite(image, dest=offset)
        return canvas

    aspect_source = image.width / max(image.height, 1)
    aspect_target = width / max(height, 1)
    if resize_mode == "fill":
        if aspect_source > aspect_target:
            scaled_height = height
            scaled_width = round(height * aspect_source)
        else:
            scaled_width = width
            scaled_height = round(width / max(aspect_source, 1e-6))
    else:
        if aspect_source > aspect_target:
            scaled_width = width
            scaled_height = round(width / max(aspect_source, 1e-6))
        else:
            scaled_height = height
            scaled_width = round(height * aspect_source)

    scaled = image.resize((max(1, scaled_width), max(1, scaled_height)), Image.Resampling.LANCZOS)
    canvas = make_blank_rgba(width, height)
    offset = ((width - scaled.width) // 2, (height - scaled.height) // 2)
    canvas.alpha_composite(scaled, dest=offset)
    return canvas


def background_rgba(document: dict[str, Any]) -> Image.Image | None:
    background = document.get("background") if isinstance(document.get("background"), dict) else {}
    mode = background.get("mode") or DEFAULT_BACKGROUND_MODE
    if mode != "solid":
        return None
    width = clamp_canvas_size(document.get("width"), default=DEFAULT_WIDTH)
    height = clamp_canvas_size(document.get("height"), default=DEFAULT_HEIGHT)
    return Image.new("RGBA", (width, height), rgba_from_hex(background.get("color") or DEFAULT_BACKGROUND_COLOR))


def _grayscale_rgb_image(unit_array: np.ndarray) -> Image.Image:
    grayscale = np.clip(unit_array, 0.0, 1.0)
    payload = np.clip(grayscale * 255.0, 0.0, 255.0).astype(np.uint8)
    stacked = np.repeat(payload[..., None], 3, axis=-1)
    return Image.fromarray(stacked, mode="RGB")


def _composite_material_surface(
    document: dict[str, Any],
    *,
    include_hidden: bool = False,
) -> np.ndarray:
    width = clamp_canvas_size(document.get("width"), default=DEFAULT_WIDTH)
    height = clamp_canvas_size(document.get("height"), default=DEFAULT_HEIGHT)
    composite = np.asarray(make_blank_rgba(width, height), dtype=np.float32) / 255.0

    for layer in document.get("layers", []):
        if not include_hidden and not layer.get("visible", True):
            continue
        material_image = layer.get("materialImage")
        if not isinstance(material_image, Image.Image):
            continue
        rgba = _resize_for_document(material_image.convert("RGBA"), width, height, "stretch")
        rgba_np = np.asarray(rgba, dtype=np.float32) / 255.0
        composite = _alpha_composite(
            composite,
            rgba_np,
            float(layer.get("opacity", 1.0)),
            "normal",
        )
    return composite


def _derive_light_map(height_map: np.ndarray, roughness_map: np.ndarray, specular_map: np.ndarray, coverage: np.ndarray) -> np.ndarray:
    padded = np.pad(height_map, ((1, 1), (1, 1)), mode="edge")
    dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) * 0.5
    dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) * 0.5

    nx = -dx * 3.2
    ny = -dy * 3.2
    nz = np.ones_like(height_map)
    length = np.sqrt((nx * nx) + (ny * ny) + (nz * nz))
    nx = np.divide(nx, np.clip(length, 1e-6, None))
    ny = np.divide(ny, np.clip(length, 1e-6, None))
    nz = np.divide(nz, np.clip(length, 1e-6, None))

    light_dir = np.array([-0.42, -0.34, 0.84], dtype=np.float32)
    light_dir /= np.linalg.norm(light_dir)
    diffuse = np.clip((nx * light_dir[0]) + (ny * light_dir[1]) + (nz * light_dir[2]), 0.0, 1.0)

    half_dir = light_dir + np.array([0.0, 0.0, 1.0], dtype=np.float32)
    half_dir /= np.linalg.norm(half_dir)
    ndoth = np.clip((nx * half_dir[0]) + (ny * half_dir[1]) + (nz * half_dir[2]), 0.0, 1.0)
    spec_power = 10.0 + ((1.0 - roughness_map) * 42.0)
    specular = np.power(ndoth, spec_power) * specular_map * (0.24 + (height_map * 0.76))

    ambient = 0.14 + (height_map * 0.18)
    light = ambient + (diffuse * (0.18 + (height_map * 0.82))) + (specular * 0.7)
    return np.clip(light * coverage, 0.0, 1.0)


def render_document(
    document: dict[str, Any],
    *,
    background_image: torch.Tensor | None = None,
    flatten_background: bool = True,
    include_hidden: bool = False,
) -> tuple[Image.Image, Image.Image]:
    width = clamp_canvas_size(document.get("width"), default=DEFAULT_WIDTH)
    height = clamp_canvas_size(document.get("height"), default=DEFAULT_HEIGHT)
    composite = np.asarray(make_blank_rgba(width, height), dtype=np.float32) / 255.0

    for layer in document.get("layers", []):
        if not include_hidden and not layer.get("visible", True):
            continue
        image = layer.get("image")
        if not isinstance(image, Image.Image):
            continue
        rgba = _resize_for_document(image.convert("RGBA"), width, height, "stretch")
        rgba_np = np.asarray(rgba, dtype=np.float32) / 255.0
        composite = _alpha_composite(
            composite,
            rgba_np,
            float(layer.get("opacity", 1.0)),
            str(layer.get("blendMode") or "normal"),
        )

    alpha_image = Image.fromarray(np.clip(composite[..., 3] * 255.0, 0.0, 255.0).astype(np.uint8), mode="L")
    final_rgba = composite.copy()

    if flatten_background:
        background = None
        if background_image is not None:
            bg = tensor_to_pil_rgb(background_image, width=width, height=height)
            if bg is not None:
                background = bg.convert("RGBA")
        if background is None:
            background = background_rgba(document)
        if background is not None:
            background_np = np.asarray(background, dtype=np.float32) / 255.0
            final_rgba = _alpha_composite(background_np, final_rgba, 1.0, "normal")

    rgb_image = Image.fromarray(np.clip(final_rgba[..., :3] * 255.0, 0.0, 255.0).astype(np.uint8), mode="RGB")
    return rgb_image, alpha_image


def render_document_material_maps(
    document: dict[str, Any],
    *,
    include_hidden: bool = False,
) -> dict[str, Image.Image]:
    composite = _composite_material_surface(document, include_hidden=include_hidden)
    coverage = np.clip(composite[..., 3], 0.0, 1.0)
    height_map = np.clip(composite[..., 0] * coverage, 0.0, 1.0)
    roughness_map = np.clip(composite[..., 1] * coverage, 0.0, 1.0)
    specular_map = np.clip(composite[..., 2] * coverage, 0.0, 1.0)
    light_map = _derive_light_map(height_map, roughness_map, specular_map, coverage)
    return {
        "height": _grayscale_rgb_image(height_map),
        "roughness": _grayscale_rgb_image(roughness_map),
        "specular": _grayscale_rgb_image(specular_map),
        "light": _grayscale_rgb_image(light_map),
    }


def resolve_runtime_document(document: dict[str, Any]) -> dict[str, Any]:
    metadata = metadata_only(document)
    runtime = copy.deepcopy(metadata)
    runtime["layers"] = []
    for layer in document.get("layers", []):
        layer_id = str(layer.get("id") or "")
        image = layer.get("image")
        layer_record = next((item for item in metadata["layers"] if item["id"] == layer_id), None)
        if layer_record is None:
            continue
        runtime_layer = {**layer_record}
        if isinstance(image, Image.Image):
            runtime_layer["image"] = _resize_for_document(
                image.convert("RGBA"),
                runtime["width"],
                runtime["height"],
                "stretch",
            )
        else:
            runtime_layer["image"] = make_blank_rgba(runtime["width"], runtime["height"])
        material_image = layer.get("materialImage")
        if isinstance(material_image, Image.Image):
            runtime_layer["materialImage"] = _resize_for_document(
                material_image.convert("RGBA"),
                runtime["width"],
                runtime["height"],
                "stretch",
            )
        else:
            runtime_layer["materialImage"] = make_blank_rgba(runtime["width"], runtime["height"])
        runtime["layers"].append(runtime_layer)
    if not runtime["layers"]:
        runtime["layers"] = [
            {
                **metadata["layers"][0],
                "image": make_blank_rgba(runtime["width"], runtime["height"]),
                "materialImage": make_blank_rgba(runtime["width"], runtime["height"]),
            }
        ]
        runtime["activeLayerId"] = runtime["layers"][0]["id"]
    return runtime


def import_image_layer(
    document: dict[str, Any],
    *,
    image: torch.Tensor,
    mask: torch.Tensor | None,
    layer_name: str,
    blend_mode: str,
    opacity: float,
    visible: bool,
    placement: str,
    resize_mode: str,
) -> dict[str, Any]:
    runtime = clone_runtime_document(resolve_runtime_document(document))
    width = runtime["width"]
    height = runtime["height"]
    imported = image_and_mask_to_rgba(image, mask, width=width if resize_mode == "stretch" else None, height=height if resize_mode == "stretch" else None)
    imported = _resize_for_document(imported, width, height, resize_mode)

    layer_id = f"import_{uuid4().hex}"
    layer = {
        "id": layer_id,
        "name": layer_name.strip() or f"Imported Layer {len(runtime['layers']) + 1}",
        "visible": bool(visible),
        "opacity": float(np.clip(opacity, 0.0, 1.0)),
        "blendMode": blend_mode if blend_mode in BLEND_MODES else "normal",
        "locked": False,
        "thumbnailVersion": 0,
        "updatedAt": None,
        "image": imported,
        "materialImage": make_blank_rgba(width, height),
    }

    if placement == "bottom":
        runtime["layers"].insert(0, layer)
    else:
        runtime["layers"].append(layer)
    runtime["activeLayerId"] = layer_id
    return runtime


def extract_layer_image(document: dict[str, Any], layer_name: str = "", layer_index: int = -1) -> tuple[Image.Image, Image.Image, dict[str, Any]]:
    runtime = resolve_runtime_document(document)
    layer = None

    if layer_name.strip():
        wanted = layer_name.strip().lower()
        layer = next((item for item in runtime["layers"] if str(item.get("name") or "").strip().lower() == wanted), None)

    if layer is None:
        if 0 <= layer_index < len(runtime["layers"]):
            layer = runtime["layers"][layer_index]
        elif runtime["layers"]:
            layer = runtime["layers"][-1]

    if layer is None:
        blank = make_blank_rgba(runtime["width"], runtime["height"])
        return blank.convert("RGB"), blank.getchannel("A"), {"found": False}

    image = layer["image"].convert("RGBA")
    layer_only = dict(runtime)
    layer_only["layers"] = [{key: value for key, value in layer.items() if key != "image"}]
    return image.convert("RGB"), image.getchannel("A"), {"found": True, **metadata_only(layer_only)["layers"][0]}
