<p align="center">
  <img src="assets/comfypencil-banner.svg" alt="ComfyPencil banner" width="100%" />
</p>

# ComfyPencil

Full-screen painting workspace for ComfyUI with saved layered documents, brush editing, split preview, and workflow-friendly render outputs.

Brush studio · Layer stack · `.pencilstudio` projects · Split preview · Texture map outputs

## Overview

ComfyPencil replaces the usual paint-outside-import-later workflow with a dedicated studio window inside ComfyUI. It gives you one place to paint, manage layers, edit brush presets, save layered project files, and push image data straight into the graph.

It is built for the case where painting is part of the workflow, not a separate step around it.

## Highlights

- Full-screen painting studio opened from the node, the selection toolbox, the sidebar tab, or the Extensions menu
- Brush library and brush studio with editable presets, pressure response, dynamics, wet mix, material channels, and custom saves
- Layer stack with reorder, duplicate, lock, alpha lock, blend modes, opacity, thumbnails, and per-layer persistence
- Native `.pencilstudio` format for portable layered save/load
- Split preview with downstream receiver support so you can paint while watching the graph result
- Material-aware painting that can output `height`, `roughness`, `specular`, and `light` maps for texture workflows
- Persistent document storage under the node pack so workflow files stay small

## What ComfyPencil Handles

ComfyPencil is meant to be a working surface, not just another image input. The studio handles:

- Brush authoring and custom preset saves
- Layered raster painting with saved document state
- Canvas assist settings such as symmetry, rotation, and stroke constraints
- Split preview round-tripping through downstream workflow nodes
- Portable project export/import through `.pencilstudio`
- Material painting for texture-oriented workflows

## Included Nodes

- [`Comfy Pencil Studio`](web/docs/ComfyPencilStudio.md)
  Main authoring node. Opens the studio and outputs the current document render.
- [`Comfy Pencil Receive Preview`](web/docs/ComfyPencilReceivePreview.md)
  Stores a downstream image back into the studio split preview.
- [`Comfy Pencil Render Document`](web/docs/ComfyPencilRenderDocument.md)
  Renders a `PENCIL_DOCUMENT` into `IMAGE`, `MASK`, and material maps.
- [`Comfy Pencil Import Layer`](web/docs/ComfyPencilImportLayer.md)
  Injects upstream images or masks as new layers in the document.
- [`Comfy Pencil Extract Layer`](web/docs/ComfyPencilExtractLayer.md)
  Pulls out a specific layer for downstream processing.

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/criskb/Comfypencil ComfyPencil
```

Then:

1. Restart ComfyUI.
2. Hard refresh the browser after frontend updates.
3. Add a `Comfy Pencil Studio` node to a graph.
4. Open the studio and start painting.

ComfyPencil currently targets `ComfyUI >= 0.16.0` in [pyproject.toml](pyproject.toml).

## Using ComfyPencil

1. Add `Comfy Pencil Studio`.
2. Paint, manage layers, and save presets inside the studio.
3. Send the node outputs downstream like any other ComfyUI image source.
4. If you want live feedback, connect a `Comfy Pencil Receive Preview` node and enable split view.
5. Save the artwork either as document state in the node storage or as a portable `.pencilstudio` project.

Included examples:

- [example_workflows/comfypencil_basic.json](example_workflows/comfypencil_basic.json)
- [example_workflows/comfypencil_split_preview.json](example_workflows/comfypencil_split_preview.json)

## Storage And Project Files

ComfyPencil keeps document data on disk instead of embedding full bitmap payloads into the workflow JSON.

- Stored documents live under `data/documents/<document_id>/`
- Layer color and material images are saved as PNGs
- The node keeps lightweight document identity data in the graph
- `.pencilstudio` bundles are the portable export format for layered artwork

## Material Outputs

When material painting is enabled in the brush settings, ComfyPencil can send separate downstream maps for:

- `height`
- `roughness`
- `specular`
- `light`

This makes the node usable for painting texture support maps linked to 3D or look-dev workflows instead of only flat color.

## Current Focus

ComfyPencil is moving fast and still actively being shaped.

Current gaps worth knowing about:

- Browser blend preview and backend blend render are close, but not perfectly identical yet
- There is still no transform tool, lasso workflow, text layer, or vector stroke system
- The brush engine and UI are under active refinement

## Project Layout

```text
ComfyPencil/
├── __init__.py
├── assets/
│   └── comfypencil-banner.svg
├── backend/
│   ├── nodes.py
│   ├── routes.py
│   ├── store.py
│   └── rendering.py
├── example_workflows/
│   └── comfypencil_basic.json
├── tests/
│   └── test_backend.py
├── web/
│   ├── comfy_pencil_extension.js
│   ├── docs/
│   └── studio/
└── README.md
```

## Development Notes

- Main frontend extension entry: [web/comfy_pencil_extension.js](web/comfy_pencil_extension.js)
- Studio UI shell: [web/studio/studio-app.js](web/studio/studio-app.js)
- Canvas engine: [web/studio/canvas-engine.js](web/studio/canvas-engine.js)
- Brush rendering path: [web/studio/brush-stamp.js](web/studio/brush-stamp.js)
- Document/project persistence: [backend/store.py](backend/store.py)
- Node implementations: [backend/nodes.py](backend/nodes.py)

Useful checks while working on the pack:

```bash
python3 tests/test_backend.py
python3 -m py_compile backend/store.py backend/routes.py backend/nodes.py
node --check --input-type=module < web/studio/studio-app.js
```

## License

See [LICENSE](LICENSE).
