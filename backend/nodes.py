"""ComfyUI node implementations for ComfyPencil."""

from __future__ import annotations

import json
from typing import Any

from PIL import Image, ImageOps

from .constants import (
    BLEND_MODES,
    CATEGORY_ROOT,
    DEFAULT_BACKGROUND_COLOR,
    DEFAULT_BACKGROUND_MODE,
    DEFAULT_DOCUMENT_NAME,
    DEFAULT_HEIGHT,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_SECONDARY_COLOR,
    DEFAULT_WIDTH,
    DOCUMENT_DATA_TYPE,
    EXTRACT_NODE_ID,
    IMPORT_NODE_ID,
    PREVIEW_RECEIVER_NODE_ID,
    RENDER_NODE_ID,
    STUDIO_NODE_ID,
)
from .rendering import (
    document_summary_json,
    extract_layer_image,
    make_blank_rgba,
    import_image_layer,
    pil_to_image_tensor,
    pil_to_mask_tensor,
    render_document,
    render_document_material_maps,
    resolve_runtime_document,
    tensor_to_pil_rgb,
)
from .store import load_runtime_document, save_runtime_document, save_split_preview


DOCUMENT_SOCKET = (DOCUMENT_DATA_TYPE, {"forceInput": True})


def _studio_preview_key(unique_id: Any) -> str:
    value = str(unique_id or "").strip()
    return f"studio-node-{value}" if value else ""


def _resolve_document(
    *,
    document: dict[str, Any] | None,
    document_id: str,
    revision: int,
    document_name: str,
    canvas_width: int,
    canvas_height: int,
    background_mode: str,
    background_color: str,
) -> dict[str, Any]:
    if isinstance(document, dict):
        if document.get("id") and not any(isinstance(layer.get("image"), Image.Image) for layer in document.get("layers", [])):
            try:
                return load_runtime_document(str(document["id"]))
            except Exception:
                pass
        return resolve_runtime_document(document)

    if document_id.strip():
        try:
            return load_runtime_document(document_id.strip())
        except Exception:
            pass

    return {
        "id": "",
        "revision": int(revision or 0),
        "version": 1,
        "name": document_name or DEFAULT_DOCUMENT_NAME,
        "width": canvas_width or DEFAULT_WIDTH,
        "height": canvas_height or DEFAULT_HEIGHT,
        "createdAt": None,
        "updatedAt": None,
        "activeLayerId": "layer_1",
        "background": {
            "mode": background_mode or DEFAULT_BACKGROUND_MODE,
            "color": background_color or DEFAULT_BACKGROUND_COLOR,
        },
        "paint": {
            "primaryColor": DEFAULT_PRIMARY_COLOR,
            "secondaryColor": DEFAULT_SECONDARY_COLOR,
        },
        "layers": [
            {
                "id": "layer_1",
                "name": "Layer 1",
                "visible": True,
                "opacity": 1.0,
                "blendMode": "normal",
                "locked": False,
                "thumbnailVersion": 0,
                "updatedAt": None,
                "image": make_blank_rgba(canvas_width or DEFAULT_WIDTH, canvas_height or DEFAULT_HEIGHT),
            }
        ],
    }


def _prepare_split_preview_image(image_tensor, width: int, height: int, resize_mode: str) -> Image.Image:
    image = tensor_to_pil_rgb(image_tensor)
    if image is None:
        return make_blank_rgba(width, height)
    rgba = image.convert("RGBA")
    if resize_mode == "stretch":
        return rgba.resize((width, height), Image.Resampling.LANCZOS)
    if resize_mode == "fill":
        return ImageOps.fit(rgba, (width, height), method=Image.Resampling.LANCZOS)

    fitted = ImageOps.contain(rgba, (width, height), method=Image.Resampling.LANCZOS)
    canvas = make_blank_rgba(width, height)
    offset = ((width - fitted.width) // 2, (height - fitted.height) // 2)
    canvas.alpha_composite(fitted, dest=offset)
    return canvas


def _encode_split_prompt_conditioning(clip: Any, prompt_text: str):
    if clip is None:
        return []

    tokenize = getattr(clip, "tokenize", None)
    encode_from_tokens = getattr(clip, "encode_from_tokens", None)
    if not callable(tokenize) or not callable(encode_from_tokens):
        return []

    prompt = str(prompt_text or "")
    tokens = tokenize(prompt)
    if isinstance(tokens, dict) and "g" in tokens and "l" in tokens:
        local_tokens = tokenize(prompt).get("l", [])
        global_tokens = tokens.get("g", [])
        if len(local_tokens) != len(global_tokens):
            empty_tokens = tokenize("")
            empty_local = empty_tokens.get("l", [])
            empty_global = empty_tokens.get("g", [])
            while len(local_tokens) < len(global_tokens):
                local_tokens += empty_local
            while len(global_tokens) < len(local_tokens):
                global_tokens += empty_global
            tokens["l"] = local_tokens
            tokens["g"] = global_tokens

    encoded = encode_from_tokens(tokens, return_pooled=True)
    if isinstance(encoded, tuple):
        cond = encoded[0] if len(encoded) > 0 else None
        pooled = encoded[1] if len(encoded) > 1 else None
    else:
        cond = encoded
        pooled = None

    if cond is None:
        return []

    metadata = {}
    if pooled is not None:
        metadata["pooled_output"] = pooled
    return [[cond, metadata]]


class ComfyPencilStudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "document_name": ("STRING", {"default": DEFAULT_DOCUMENT_NAME}),
                "document_id": ("STRING", {"default": "", "multiline": False}),
                "revision": ("INT", {"default": 0, "min": 0, "max": 999999999, "step": 1}),
                "run_token": ("INT", {"default": 0, "min": 0, "max": 999999999, "step": 1}),
                "split_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
                "canvas_width": ("INT", {"default": DEFAULT_WIDTH, "min": 64, "max": 4096, "step": 8}),
                "canvas_height": ("INT", {"default": DEFAULT_HEIGHT, "min": 64, "max": 4096, "step": 8}),
                "background_mode": (["transparent", "solid"], {"default": DEFAULT_BACKGROUND_MODE}),
                "background_color": ("STRING", {"default": DEFAULT_BACKGROUND_COLOR}),
                "flatten_background": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "document": DOCUMENT_SOCKET,
                "background_image": ("IMAGE",),
                "clip": ("CLIP",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (DOCUMENT_DATA_TYPE, "IMAGE", "MASK", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "CONDITIONING")
    RETURN_NAMES = ("document", "image", "mask", "height", "roughness", "specular", "light", "metadata_json", "conditioning")
    FUNCTION = "render"
    CATEGORY = f"{CATEGORY_ROOT}/studio"
    SEARCH_ALIASES = ["paint", "draw", "sketch", "canvas", "procreate"]

    def render(
        self,
        document_name,
        document_id,
        revision,
        run_token=0,
        split_prompt="",
        canvas_width=DEFAULT_WIDTH,
        canvas_height=DEFAULT_HEIGHT,
        background_mode=DEFAULT_BACKGROUND_MODE,
        background_color=DEFAULT_BACKGROUND_COLOR,
        flatten_background=False,
        document=None,
        background_image=None,
        clip=None,
        unique_id=None,
    ):
        # Accept the legacy positional signature where `run_token` did not exist yet.
        if (
            not isinstance(canvas_height, (int, float))
            or str(background_mode or "") not in {"transparent", "solid"}
        ):
            flatten_background = background_color
            background_color = background_mode
            background_mode = canvas_height
            canvas_height = split_prompt
            canvas_width = run_token
            split_prompt = ""
            run_token = 0

        runtime_document = _resolve_document(
            document=document,
            document_id=document_id,
            revision=revision,
            document_name=document_name,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            background_mode=background_mode,
            background_color=background_color,
        )
        _ = run_token
        runtime_document["studioNodeId"] = str(unique_id or runtime_document.get("studioNodeId") or "")
        runtime_document["previewKey"] = str(
            runtime_document.get("previewKey")
            or runtime_document.get("id")
            or _studio_preview_key(unique_id)
        )
        requested_width = int(canvas_width or runtime_document.get("width") or DEFAULT_WIDTH)
        requested_height = int(canvas_height or runtime_document.get("height") or DEFAULT_HEIGHT)
        if (
            int(runtime_document.get("width") or 0) != requested_width
            or int(runtime_document.get("height") or 0) != requested_height
        ):
            runtime_document = resolve_runtime_document({
                **runtime_document,
                "width": requested_width,
                "height": requested_height,
            })
            runtime_document["studioNodeId"] = str(unique_id or runtime_document.get("studioNodeId") or "")
            runtime_document["previewKey"] = str(
                runtime_document.get("previewKey")
                or runtime_document.get("id")
                or _studio_preview_key(unique_id)
            )
        conditioning = _encode_split_prompt_conditioning(clip, split_prompt)
        image, mask = render_document(
            runtime_document,
            background_image=background_image,
            flatten_background=flatten_background,
        )
        material_maps = render_document_material_maps(runtime_document)
        return (
            runtime_document,
            pil_to_image_tensor(image),
            pil_to_mask_tensor(mask),
            pil_to_image_tensor(material_maps["height"]),
            pil_to_image_tensor(material_maps["roughness"]),
            pil_to_image_tensor(material_maps["specular"]),
            pil_to_image_tensor(material_maps["light"]),
            document_summary_json(runtime_document),
            conditioning,
        )


class ComfyPencilImportLayer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "document": DOCUMENT_SOCKET,
                "image": ("IMAGE",),
                "layer_name": ("STRING", {"default": "Imported Layer"}),
                "blend_mode": (list(BLEND_MODES), {"default": "normal"}),
                "opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "visible": ("BOOLEAN", {"default": True}),
                "placement": (["top", "bottom"], {"default": "top"}),
                "resize_mode": (["fit", "fill", "stretch", "center"], {"default": "fit"}),
                "persist_to_source": ("BOOLEAN", {"default": True}),
                "flatten_background": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = (DOCUMENT_DATA_TYPE, "IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("document", "image", "mask", "metadata_json")
    FUNCTION = "import_layer"
    CATEGORY = f"{CATEGORY_ROOT}/document"
    SEARCH_ALIASES = ["paint import", "layer import", "upstream draw"]

    def import_layer(
        self,
        document,
        image,
        layer_name,
        blend_mode,
        opacity,
        visible,
        placement,
        resize_mode,
        persist_to_source,
        flatten_background,
        mask=None,
    ):
        runtime_document = import_image_layer(
            document,
            image=image,
            mask=mask,
            layer_name=layer_name,
            blend_mode=blend_mode,
            opacity=opacity,
            visible=visible,
            placement=placement,
            resize_mode=resize_mode,
        )
        if persist_to_source and runtime_document.get("id"):
            runtime_document = save_runtime_document(runtime_document)
        rendered_image, rendered_mask = render_document(runtime_document, flatten_background=flatten_background)
        return (
            runtime_document,
            pil_to_image_tensor(rendered_image),
            pil_to_mask_tensor(rendered_mask),
            document_summary_json(runtime_document),
        )


class ComfyPencilRenderDocument:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "document": DOCUMENT_SOCKET,
                "flatten_background": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "background_image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("image", "mask", "height", "roughness", "specular", "light", "metadata_json")
    FUNCTION = "render_document"
    CATEGORY = f"{CATEGORY_ROOT}/document"
    SEARCH_ALIASES = ["paint render", "draw render", "document output"]

    def render_document(self, document, flatten_background, background_image=None):
        runtime_document = resolve_runtime_document(document)
        image, mask = render_document(runtime_document, flatten_background=flatten_background, background_image=background_image)
        material_maps = render_document_material_maps(runtime_document)
        return (
            pil_to_image_tensor(image),
            pil_to_mask_tensor(mask),
            pil_to_image_tensor(material_maps["height"]),
            pil_to_image_tensor(material_maps["roughness"]),
            pil_to_image_tensor(material_maps["specular"]),
            pil_to_image_tensor(material_maps["light"]),
            document_summary_json(runtime_document),
        )


class ComfyPencilExtractLayer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "document": DOCUMENT_SOCKET,
                "layer_name": ("STRING", {"default": "", "multiline": False}),
                "layer_index": ("INT", {"default": -1, "min": -1, "max": 9999, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "layer_json")
    FUNCTION = "extract_layer"
    CATEGORY = f"{CATEGORY_ROOT}/document"
    SEARCH_ALIASES = ["layer output", "draw extract", "paint extract"]

    def extract_layer(self, document, layer_name, layer_index):
        image, mask, layer_meta = extract_layer_image(document, layer_name=layer_name, layer_index=layer_index)
        return (
            pil_to_image_tensor(image),
            pil_to_mask_tensor(mask),
            json.dumps(layer_meta, indent=2, sort_keys=True),
        )


class ComfyPencilReceivePreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "document": DOCUMENT_SOCKET,
                "image": ("IMAGE",),
                "resize_mode": (["fit", "fill", "stretch"], {"default": "fit"}),
            }
        }

    RETURN_TYPES = (DOCUMENT_DATA_TYPE, "IMAGE", "STRING")
    RETURN_NAMES = ("document", "image", "status")
    FUNCTION = "receive_preview"
    CATEGORY = f"{CATEGORY_ROOT}/studio"
    SEARCH_ALIASES = ["split preview", "studio preview", "reference receiver"]

    def receive_preview(self, document, image, resize_mode):
        runtime_document = resolve_runtime_document(document)
        document_id = str(runtime_document.get("id") or "").strip()
        studio_preview_key = str(runtime_document.get("previewKey") or "").strip()
        studio_node_key = _studio_preview_key(runtime_document.get("studioNodeId"))
        preview_keys = [key for key in dict.fromkeys([document_id, studio_preview_key, studio_node_key]) if key]
        if not preview_keys:
            return (
                runtime_document,
                image,
                "Split preview skipped. Open the studio once so the receiver has a stable target.",
            )

        preview = _prepare_split_preview_image(
            image,
            width=int(runtime_document["width"]),
            height=int(runtime_document["height"]),
            resize_mode=str(resize_mode or "fit"),
        )
        for preview_key in preview_keys:
            save_split_preview(preview_key, preview)
        return (
            runtime_document,
            image,
            f"Split preview updated for {preview_keys[0]}.",
        )


NODE_CLASS_MAPPINGS = {
    STUDIO_NODE_ID: ComfyPencilStudio,
    PREVIEW_RECEIVER_NODE_ID: ComfyPencilReceivePreview,
    IMPORT_NODE_ID: ComfyPencilImportLayer,
    RENDER_NODE_ID: ComfyPencilRenderDocument,
    EXTRACT_NODE_ID: ComfyPencilExtractLayer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    STUDIO_NODE_ID: "Comfy Pencil Studio",
    PREVIEW_RECEIVER_NODE_ID: "Comfy Pencil Receive Preview",
    IMPORT_NODE_ID: "Comfy Pencil Import Layer",
    RENDER_NODE_ID: "Comfy Pencil Render Document",
    EXTRACT_NODE_ID: "Comfy Pencil Extract Layer",
}
