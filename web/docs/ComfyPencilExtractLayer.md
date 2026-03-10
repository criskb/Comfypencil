# Comfy Pencil Extract Layer

Extract one layer from a `PENCIL_DOCUMENT` by name or by index.

This is useful for:

- Sending only line art to ControlNet or preprocessing
- Pulling a paint-over layer into a separate branch
- Using the layer alpha as a focused mask

## Notes

- If `layer_name` is set, it takes priority over `layer_index`.
- `layer_index = -1` uses the active layer.
- `layer_json` returns the exported layer metadata so you can inspect visibility, opacity, blend mode, and ids downstream.
