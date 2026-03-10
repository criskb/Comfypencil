# Comfy Pencil Import Layer

Use this node when an upstream workflow result should become a paint layer inside a ComfyPencil document.

## Typical use

- Feed a generated image into the document as a new top layer
- Import a mask-backed layer
- Persist the result back into the source studio document when `persist_to_source` is enabled

## Notes

- `placement` controls whether the imported layer is inserted at the top or bottom of the stack.
- `resize_mode` controls how the incoming image is fit to the document canvas.
- `flatten_background` only affects the rendered `image` output from this node, not the stored layer data.
