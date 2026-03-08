# Comfy Pencil Studio

Open the drawing workspace from the node button, the selection toolbox, the Comfy Pencil sidebar tab, or `Extensions -> Comfy Pencil`.

## What it does

- Stores a persistent layered painting document on disk
- Saves and opens portable `.pencilstudio` project files with layer data intact
- Outputs the current composite as `IMAGE`
- Outputs the current alpha as `MASK`
- Sends a `PENCIL_DOCUMENT` payload downstream for other ComfyPencil nodes

## Recommended flow

1. Add `Comfy Pencil Studio`.
2. Open the studio and paint on layers.
3. Preview the direct `IMAGE` output or route the `PENCIL_DOCUMENT` into the render, import, or extract nodes.

## Notes

- `document_id` and `revision` are internal workflow fields and are managed by the frontend.
- `flatten_background` bakes the paper tone into the `IMAGE` output. Leave it off if you want to composite with the `MASK` downstream.
- Use `Open Project` and `Save Project` in the Canvas panel for portable artwork files. Use `Save` to persist the current node-backed document in place.
