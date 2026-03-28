export const STUDIO_SHORTCUT_SECTIONS = [
  {
    title: "Studio",
    items: [
      { keys: ["Cmd/Ctrl", "S"], description: "Save now" },
      { keys: ["Cmd/Ctrl", "Z"], description: "Undo" },
      { keys: ["Cmd/Ctrl", "Shift", "Z"], description: "Redo" },
      { keys: ["F"], description: "Hide or show the interface" },
      { keys: ["Tab"], description: "Hide or show the interface" },
      { keys: ["Q"], description: "Open the quick menu" },
      { keys: ["?"], description: "Open shortcut help" },
      { keys: ["Cmd/Ctrl", "V"], description: "Paste an image from the clipboard as a new layer" },
      { keys: ["Esc"], description: "Close help, close the brush editor, or close the studio" },
    ],
  },
  {
    title: "Tools",
    items: [
      { keys: ["B"], description: "Brush" },
      { keys: ["E"], description: "Eraser" },
      { keys: ["M"], description: "Blend" },
      { keys: ["G"], description: "Fill" },
      { keys: ["I"], description: "Color picker" },
      { keys: ["H"], description: "Pan tool" },
      { keys: ["X"], description: "Swap primary and secondary colors" },
      { keys: ["D"], description: "Reset paint colors to defaults" },
      { keys: ["V"], description: "Toggle split preview" },
    ],
  },
  {
    title: "Brush And Canvas",
    items: [
      { keys: ["["], description: "Decrease brush size" },
      { keys: ["]"], description: "Increase brush size" },
      { keys: [","], description: "Rotate canvas left" },
      { keys: ["."], description: "Rotate canvas right" },
      { keys: ["\\"], description: "Cycle symmetry mode" },
      { keys: ["L"], description: "Cycle line assist snap" },
      { keys: ["Space"], description: "Temporary pan while drawing" },
      { keys: ["Double Click", "Brush button"], description: "Open Brush Studio" },
    ],
  },
];
