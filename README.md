# ComfyPencil

ComfyPencil turns a ComfyUI node into a layered drawing studio. It ships a full-screen paint workspace, persistent document storage, and workflow nodes that keep the painting surface connected to downstream graph execution.

## Current feature set

- Full-screen drawing studio opened from the node, selection toolbox, sidebar tab, or Extensions menu
- Pressure-aware raster brush engine with presets for pencil, ink, marker, airbrush, eraser, fill, eyedropper, and blend-soften
- Layer stack with visibility, opacity, blend modes, duplicate, reorder, delete, and thumbnails
- Color wheel, swatches, hex input, size/opacity/flow/hardness controls, zoom, pan, fit-to-view, undo/redo
- Persistent on-disk document storage so workflow JSON stays small
- Native `.pencilstudio` project files for portable save and load of layered artwork
- Workflow nodes for studio output, document rendering, upstream image import as layers, and layer extraction

## Node overview

- `Comfy Pencil Studio`
  The main authoring node. It owns the saved document reference and renders the latest studio state into `IMAGE` and `MASK`.
- `Comfy Pencil Import Layer`
  Takes an upstream `IMAGE` or `MASK` and injects it as a new document layer.
- `Comfy Pencil Render Document`
  Converts a `PENCIL_DOCUMENT` back into `IMAGE` and `MASK`.
- `Comfy Pencil Extract Layer`
  Pulls a named or indexed layer out of a document for downstream work.

## Files and persistence

Documents are stored under `data/documents/<document_id>/` inside the node pack. The node keeps only the document id and revision in the graph.
You can also export and reopen portable `.pencilstudio` files from the Canvas panel in the studio.

## Known limits in this first version

- Blend mode preview in the browser uses canvas compositing, while backend render modes use CPU formulas. They are close, but not pixel-identical.
- There is no transform tool, lasso, text layer, or vector stroke model yet.
- Imported upstream layers are persisted when `persist_to_source` is enabled, which is convenient but intentionally stateful.

## Verification

Backend modules compile with `python -m py_compile`.
Frontend modules pass `node --check`.
Backend smoke tests cover document create/save/render behavior.
