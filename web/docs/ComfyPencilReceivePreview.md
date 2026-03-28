# Comfy Pencil Receive Preview

Store a downstream `IMAGE` as the split-view artboard for a studio document.

Use this when a workflow branch processes the studio output and you want that processed result to appear back inside the studio as the secondary preview artboard.

Typical flow:

1. Connect `document` from the studio node into this node.
2. Run the studio `image` output through any downstream image nodes you want.
3. Connect the processed `IMAGE` into this node.
4. Open the studio and enable `Split` to see the stored preview artboard beside the main canvas.

Notes:

- The split preview is keyed by the document id.
- Open the studio at least once so the document has a stable id before relying on the preview receiver.
- `resize_mode` controls how the incoming image is fit into the document dimensions before being shown in split view.
- In split view you can use the dock prompt field, `Refresh`, `Active Run`, and `Stop` from the bottom-center dock to drive the background workflow and update this preview.
