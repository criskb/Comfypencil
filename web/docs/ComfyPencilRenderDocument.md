# Comfy Pencil Render Document

Render a `PENCIL_DOCUMENT` into standard image outputs plus the derived material maps.

Use this when a workflow branch needs the painted result without depending on the main studio node's direct image output.

## Outputs

- `image`: rendered document color
- `mask`: rendered document alpha
- `height`
- `roughness`
- `specular`
- `light`
- `metadata_json`: summary payload for inspection or logging

## Notes

- `background_image` can be supplied when you want the render to composite over another image.
- `flatten_background` bakes the paper tone into the `image` output instead of leaving transparency intact.
