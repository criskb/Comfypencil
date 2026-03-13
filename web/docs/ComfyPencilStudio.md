# Comfy Pencil Studio

Open the drawing workspace from the node button, the selection toolbox, the Comfy Pencil sidebar tab, or `Extensions -> Comfy Pencil`.

## What it does

- Stores a persistent layered painting document on disk
- Saves and opens portable `.pencilstudio` project files with layer data intact
- Outputs the current composite as `IMAGE`
- Outputs the current alpha as `MASK`
- Outputs `height`, `roughness`, `specular`, and `light` maps from the document material data
- Sends a `PENCIL_DOCUMENT` payload downstream for other ComfyPencil nodes

## Outputs

- `document`: persistent layered document payload for the other ComfyPencil nodes
- `image`: current rendered color result
- `mask`: current alpha mask
- `height`, `roughness`, `specular`, `light`: material support maps for texture-oriented workflows
- `metadata_json`: document summary for debugging or sidecar use

## Recommended flow

1. Add `Comfy Pencil Studio`.
2. Open the studio and paint on layers.
3. Preview the direct `image` output or route the `document` output into the render, import, extract, or receive-preview nodes.
4. Use `Split` plus `Comfy Pencil Receive Preview` when you want the graph to feed an image back into the studio.

## Notes

- `document_id`, `revision`, and `run_token` are internal workflow fields managed by the frontend.
- `flatten_background` bakes the paper tone into the `IMAGE` output. Leave it off if you want to composite with the `MASK` downstream.
- Use `Open Project` and `Save Project` in the Canvas panel for portable artwork files. Use `Save` to persist the current node-backed document in place.
- The studio keeps a local recovery draft in browser storage by default and offers restore if it finds newer unsaved work.
- Use `Import` and `Export` in the Brush Library to move preset libraries between setups.
- The Colors panel supports a persistent custom palette, plus palette import/export.
- Drop supported files onto the studio, or paste an image from the clipboard, to import layers faster.
- Press `?` or click `Help` in the header to open the built-in shortcut guide.
- The split dock supports manual refresh, timed active run, stop, and downstream export when split view is enabled.
