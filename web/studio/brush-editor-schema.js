import { BRUSH_PRESETS } from "./constants.js";
import {
  BRUSH_TEXTURE_CUSTOM,
  BRUSH_TEXTURE_NONE,
  describeBrushTextureSelection,
  getBrushTextureOptions,
  getBrushTextureSelectionValue,
  hasAssignedBrushTexture,
} from "./brush-textures.js";
import { formatLibraryGroupLabel, formatPercent, isStrokeTool } from "./studio-helpers.js";

const FIRST_PRESET = BRUSH_PRESETS[0] || {};

const STROKE_TOOL_SET = new Set(["brush", "eraser", "blend"]);
const BRUSH_TOOL_SET = new Set(["brush"]);
const BRUSH_AND_BLEND_TOOL_SET = new Set(["brush", "blend"]);
const FILL_TOOL_SET = new Set(["fill"]);

function formatPixels(value) {
  return `${Math.round(Number(value) || 0)} px`;
}

function formatMultiplier(value) {
  return `${(Number(value) || 0).toFixed(2)}x`;
}

function formatDegrees(value) {
  const numeric = Number(value) || 0;
  return `${Math.round(numeric)}deg`;
}

function formatTextValue(value, fallback = "Not set") {
  const content = String(value || "").trim();
  return content || fallback;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isOneOf(toolSet) {
  return (brush) => toolSet.has(brush?.tool);
}

function getScopedPresetOptions(brush) {
  const scope = brush?.tool === "blend" ? "blend" : "brush";
  return BRUSH_PRESETS
    .filter((preset) => preset.tool === scope)
    .map((preset) => ({
      value: preset.id,
      label: `${preset.label} · ${formatLibraryGroupLabel(preset.libraryGroup)}`,
    }));
}

function getTaperValue(brush, key) {
  const presetValue = Number(FIRST_PRESET.taper ?? 0.3);
  const current = brush?.[key];
  if (Number.isFinite(Number(current))) {
    return Number(current);
  }
  return Number(brush?.taper ?? presetValue);
}

export const BRUSH_EDITOR_SECTIONS = [
  {
    id: "stroke",
    label: "Stroke",
    title: "Stroke Path",
    description: "Base stamp spacing, opacity, flow, and stroke breakup.",
  },
  {
    id: "stabilize",
    label: "Stabilize",
    title: "Stabilization",
    description: "Streamline, stroke stabilization, and motion filtering.",
  },
  {
    id: "taper",
    label: "Taper",
    title: "Taper",
    description: "Control how the stroke enters, exits, and sharpens.",
  },
  {
    id: "shape",
    label: "Shape",
    title: "Shape",
    description: "Shape tip, scatter, rotation, count, and direction follow.",
  },
  {
    id: "grain",
    label: "Grain",
    title: "Grain",
    description: "Scale, depth, contrast, and movement of the texture field.",
  },
  {
    id: "render",
    label: "Render",
    title: "Rendering",
    description: "Build-up mode, intensity, edges, and luminance response.",
  },
  {
    id: "wet",
    label: "Wet Mix",
    title: "Wet Mix",
    description: "Dilution, charge, attack, pull, grade, and blur.",
  },
  {
    id: "color",
    label: "Color",
    title: "Color Dynamics",
    description: "Vary hue, saturation, and brightness across stamps and strokes.",
  },
  {
    id: "dynamics",
    label: "Dynamics",
    title: "Dynamics",
    description: "Pressure, speed, jitter, and blend pickup behavior.",
  },
  {
    id: "pencil",
    label: "Pencil",
    title: "Apple Pencil",
    description: "Tilt-driven size, opacity, scatter, and angle response.",
  },
  {
    id: "preview",
    label: "Preview",
    title: "Preview",
    description: "Adjust how the sample stroke and preview pad present the brush.",
  },
  {
    id: "properties",
    label: "Props",
    title: "Properties",
    description: "Set lower and upper limits for size and opacity.",
  },
  {
    id: "material",
    label: "Material",
    title: "Materials",
    description: "Depth, highlight, and roughness shading for the stamp body.",
  },
  {
    id: "about",
    label: "About",
    title: "About This Brush",
    description: "Optional authoring metadata for the active brush setup.",
  },
  {
    id: "assist",
    label: "Assist",
    title: "Assist",
    description: "Fill sampling and direct-tool behavior.",
  },
];

export function getBrushEditorSectionMeta(sectionId, brush) {
  if (sectionId === "assist") {
    if (brush?.tool === "fill") {
      return {
        label: "Assist",
        title: "Fill Assist",
        description: "Threshold and layer sampling for the fill tool.",
      };
    }
    return {
      label: "Assist",
      title: "Direct Tool",
      description: "Eyedropper and pan do not use stroke-engine brush tuning.",
    };
  }
  return BRUSH_EDITOR_SECTIONS.find((section) => section.id === sectionId) || BRUSH_EDITOR_SECTIONS[0];
}

export function getBrushEditorAssistMessage(tool) {
  return {
    eyedropper: "Pick samples visible color from the canvas directly. It does not use a preset.",
    pan: "Pan only moves the view. It does not use brush dynamics or presets.",
  }[tool] || "";
}

export const BRUSH_EDITOR_CONTROLS = [
  {
    key: "presetId",
    label: "Preset",
    section: "stroke",
    type: "select",
    options: getScopedPresetOptions,
    format: (value, brush) => {
      const preset = BRUSH_PRESETS.find((item) => item.id === value);
      return preset?.label || formatTextValue(value, "Preset");
    },
    visible: (brush) => brush?.tool === "brush" || brush?.tool === "blend",
    commit: (value) => ({ presetId: value }),
  },
  {
    key: "size",
    label: "Size",
    section: "stroke",
    type: "range",
    min: 1,
    max: 240,
    step: 1,
    initial: FIRST_PRESET.size ?? 12,
    format: formatPixels,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "opacity",
    label: "Opacity",
    section: "stroke",
    type: "range",
    min: 0.01,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.opacity ?? 1,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "flow",
    label: "Flow",
    section: "stroke",
    type: "range",
    min: 0.01,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.flow ?? 0.3,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "hardness",
    label: "Hardness",
    section: "stroke",
    type: "range",
    min: 0.01,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.hardness ?? 0.75,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "spacing",
    label: "Spacing",
    section: "stroke",
    type: "range",
    min: 0.02,
    max: 0.45,
    step: 0.01,
    initial: FIRST_PRESET.spacing ?? 0.08,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "strokeJitter",
    label: "Stroke Jitter",
    section: "stroke",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.strokeJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "strokeFalloff",
    label: "Falloff",
    section: "stroke",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.strokeFalloff ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "smoothing",
    label: "Streamline",
    section: "stabilize",
    type: "range",
    min: 0,
    max: 0.95,
    step: 0.01,
    initial: FIRST_PRESET.smoothing ?? 0.35,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "stabilization",
    label: "Stabilization",
    section: "stabilize",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.stabilization ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "motionFilter",
    label: "Motion Filter",
    section: "stabilize",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.motionFilter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "motionFilterExpression",
    label: "Expression",
    section: "stabilize",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.motionFilterExpression ?? 0.5,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "startTaper",
    label: "Start Taper",
    section: "taper",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: getTaperValue(FIRST_PRESET, "startTaper"),
    getValue: (brush) => getTaperValue(brush, "startTaper"),
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
    commit: (value) => {
      const numeric = Number(value);
      return {
        startTaper: numeric,
        taper: numeric,
      };
    },
  },
  {
    key: "endTaper",
    label: "End Taper",
    section: "taper",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: getTaperValue(FIRST_PRESET, "endTaper"),
    getValue: (brush) => getTaperValue(brush, "endTaper"),
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
    commit: (value) => {
      const numeric = Number(value);
      return {
        endTaper: numeric,
        taper: numeric,
      };
    },
  },
  {
    key: "taperOpacity",
    label: "Taper Opacity",
    section: "taper",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.taperOpacity ?? 0.22,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "tipSharpness",
    label: "Tip Sharpness",
    section: "taper",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.tipSharpness ?? 0.5,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "shapeTextureSelection",
    label: "Shape Texture",
    section: "shape",
    type: "texture",
    textureKind: "shape",
    options: () => getBrushTextureOptions("shape"),
    initial: BRUSH_TEXTURE_NONE,
    getValue: (brush) => getBrushTextureSelectionValue("shape", brush),
    format: (_value, brush) => describeBrushTextureSelection("shape", brush).label,
    visible: isOneOf(STROKE_TOOL_SET),
    commit: (value) => ({
      shapeTextureId: value === BRUSH_TEXTURE_NONE || value === BRUSH_TEXTURE_CUSTOM ? "" : value,
      shapeTextureData: value === BRUSH_TEXTURE_CUSTOM ? undefined : "",
    }),
  },
  {
    key: "shapeTextureScale",
    label: "Texture Scale",
    section: "shape",
    type: "range",
    min: 0.35,
    max: 2.5,
    step: 0.01,
    initial: FIRST_PRESET.shapeTextureScale ?? 1,
    format: formatMultiplier,
    visible: (brush) => isOneOf(STROKE_TOOL_SET)(brush) && hasAssignedBrushTexture("shape", brush),
  },
  {
    key: "roundness",
    label: "Roundness",
    section: "shape",
    type: "range",
    min: 0.24,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.roundness ?? 1,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "scatter",
    label: "Scatter",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.scatter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "rotationJitter",
    label: "Angle Drift",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.rotationJitter ?? 0.05,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "stampRotation",
    label: "Stamp Rotation",
    section: "shape",
    type: "range",
    min: -180,
    max: 180,
    step: 1,
    initial: FIRST_PRESET.stampRotation ?? 0,
    format: formatDegrees,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "shapeCount",
    label: "Count",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.shapeCount ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "shapeCountJitter",
    label: "Count Jitter",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.shapeCountJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "shapeAzimuth",
    label: "Follow Stroke",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.shapeAzimuth ?? 1,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "density",
    label: "Stamp Density",
    section: "shape",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.density ?? 0.55,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "grainTextureSelection",
    label: "Grain Texture",
    section: "grain",
    type: "texture",
    textureKind: "grain",
    options: () => getBrushTextureOptions("grain"),
    initial: BRUSH_TEXTURE_NONE,
    getValue: (brush) => getBrushTextureSelectionValue("grain", brush),
    format: (_value, brush) => describeBrushTextureSelection("grain", brush).label,
    visible: isOneOf(STROKE_TOOL_SET),
    commit: (value) => ({
      grainTextureId: value === BRUSH_TEXTURE_NONE || value === BRUSH_TEXTURE_CUSTOM ? "" : value,
      grainTextureData: value === BRUSH_TEXTURE_CUSTOM ? undefined : "",
    }),
  },
  {
    key: "grain",
    label: "Texture Amount",
    section: "grain",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.grain ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "grainScale",
    label: "Scale",
    section: "grain",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.grainScale ?? 0.45,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "grainDepth",
    label: "Depth",
    section: "grain",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.grainDepth ?? 0.35,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "grainContrast",
    label: "Contrast",
    section: "grain",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.grainContrast ?? 0.5,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "grainMovement",
    label: "Movement",
    section: "grain",
    type: "select",
    options: [
      { value: "rolling", label: "Rolling" },
      { value: "static", label: "Static" },
      { value: "drift", label: "Drift" },
    ],
    initial: FIRST_PRESET.grainMovement ?? "rolling",
    format: (value) => ({
      rolling: "Rolling",
      static: "Static",
      drift: "Drift",
    }[value] || "Rolling"),
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "renderMode",
    label: "Mode",
    section: "render",
    type: "select",
    options: [
      { value: "build", label: "Build" },
      { value: "uniform", label: "Uniform" },
      { value: "glaze", label: "Glaze" },
      { value: "intense", label: "Intense" },
      { value: "soft", label: "Soft" },
    ],
    initial: FIRST_PRESET.renderMode ?? "build",
    format: (value) => formatTextValue(value, "Build"),
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "renderIntensity",
    label: "Intensity",
    section: "render",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.renderIntensity ?? 0.5,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "wetEdges",
    label: "Wet Edges",
    section: "render",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetEdges ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_AND_BLEND_TOOL_SET),
  },
  {
    key: "burntEdges",
    label: "Burnt Edges",
    section: "render",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.burntEdges ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_AND_BLEND_TOOL_SET),
  },
  {
    key: "luminanceBlend",
    label: "Luminance",
    section: "render",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.luminanceBlend ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetMix",
    label: "Wet Mix",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetMix ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetDilution",
    label: "Dilution",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetDilution ?? 0.35,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetCharge",
    label: "Charge",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetCharge ?? 0.5,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetAttack",
    label: "Attack",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetAttack ?? 0.4,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetPull",
    label: "Pull",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetPull ?? 0.35,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetGrade",
    label: "Grade",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetGrade ?? 0.4,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "wetBlur",
    label: "Blur",
    section: "wet",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.wetBlur ?? 0.14,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "hueStampJitter",
    label: "Stamp Hue",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.hueStampJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "saturationStampJitter",
    label: "Stamp Saturation",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.saturationStampJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "brightnessStampJitter",
    label: "Stamp Brightness",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.brightnessStampJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "hueStrokeJitter",
    label: "Stroke Hue",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.hueStrokeJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "saturationStrokeJitter",
    label: "Stroke Saturation",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.saturationStrokeJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "brightnessStrokeJitter",
    label: "Stroke Brightness",
    section: "color",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.brightnessStrokeJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_TOOL_SET),
  },
  {
    key: "pressureSize",
    label: "Pressure Size",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.pressureSize ?? 0.6,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "pressureOpacity",
    label: "Pressure Opacity",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.pressureOpacity ?? 0.3,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "speedThin",
    label: "Speed Thin",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.speedThin ?? 0.12,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "speedOpacity",
    label: "Speed Fade",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.speedOpacity ?? 0.08,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "sizeJitter",
    label: "Size Jitter",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.sizeJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "opacityJitter",
    label: "Opacity Jitter",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.opacityJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "flowJitter",
    label: "Flow Jitter",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.flowJitter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "speedScatter",
    label: "Speed Scatter",
    section: "dynamics",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.speedScatter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "smudgeStrength",
    label: "Smudge Pickup",
    section: "dynamics",
    type: "range",
    min: 0.05,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.smudgeStrength ?? 0.4,
    format: formatPercent,
    visible: (brush) => brush?.tool === "blend",
  },
  {
    key: "tiltSize",
    label: "Tilt Size",
    section: "pencil",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.tiltSize ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "tiltOpacity",
    label: "Tilt Opacity",
    section: "pencil",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.tiltOpacity ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "tiltScatter",
    label: "Tilt Scatter",
    section: "pencil",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.tiltScatter ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "tiltRotation",
    label: "Tilt Rotation",
    section: "pencil",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.tiltRotation ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "previewScale",
    label: "Preview Scale",
    section: "preview",
    type: "range",
    min: 0.45,
    max: 1.8,
    step: 0.01,
    initial: FIRST_PRESET.previewScale ?? 1,
    format: formatMultiplier,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "previewTilt",
    label: "Preview Tilt",
    section: "preview",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.previewTilt ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "minimumSize",
    label: "Minimum Size",
    section: "properties",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.minimumSize ?? 0,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "maximumOpacity",
    label: "Maximum Opacity",
    section: "properties",
    type: "range",
    min: 0.08,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.maximumOpacity ?? 1,
    format: formatPercent,
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "materialDepth",
    label: "Depth",
    section: "material",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.materialDepth ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_AND_BLEND_TOOL_SET),
  },
  {
    key: "materialShine",
    label: "Shine",
    section: "material",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.materialShine ?? 0,
    format: formatPercent,
    visible: isOneOf(BRUSH_AND_BLEND_TOOL_SET),
  },
  {
    key: "materialRoughness",
    label: "Roughness",
    section: "material",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    initial: FIRST_PRESET.materialRoughness ?? 0.5,
    format: formatPercent,
    visible: isOneOf(BRUSH_AND_BLEND_TOOL_SET),
  },
  {
    key: "aboutAuthor",
    label: "Author",
    section: "about",
    type: "text",
    initial: FIRST_PRESET.aboutAuthor ?? "",
    format: (value) => formatTextValue(value),
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "aboutVersion",
    label: "Version",
    section: "about",
    type: "text",
    initial: FIRST_PRESET.aboutVersion ?? "",
    format: (value) => formatTextValue(value),
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "aboutNotes",
    label: "Notes",
    section: "about",
    type: "textarea",
    rows: 4,
    initial: FIRST_PRESET.aboutNotes ?? "",
    format: (value) => {
      const text = String(value || "").trim();
      if (!text) {
        return "No notes";
      }
      return text.length > 28 ? `${text.slice(0, 27).trimEnd()}…` : text;
    },
    visible: isOneOf(STROKE_TOOL_SET),
  },
  {
    key: "fillTolerance",
    label: "Fill Tolerance",
    section: "assist",
    type: "range",
    min: 0,
    max: 128,
    step: 1,
    initial: FIRST_PRESET.fillTolerance ?? 18,
    format: (value) => `${Math.round(Number(value) || 0)}`,
    visible: isOneOf(FILL_TOOL_SET),
  },
  {
    key: "sampleAllLayers",
    label: "Fill Sampling",
    section: "assist",
    type: "select",
    options: [
      { value: "all", label: "All Layers" },
      { value: "current", label: "Current Layer" },
    ],
    initial: FIRST_PRESET.sampleAllLayers !== false ? "all" : "current",
    getValue: (brush) => (brush?.sampleAllLayers !== false ? "all" : "current"),
    format: (value) => (value === "current" ? "Current Layer" : "All Layers"),
    visible: isOneOf(FILL_TOOL_SET),
    commit: (value) => ({ sampleAllLayers: value === "all" }),
  },
];

export function isBrushEditorControlVisible(definition, brush) {
  return typeof definition.visible === "function" ? definition.visible(brush) : true;
}

export function getBrushEditorControlValue(definition, brush) {
  if (typeof definition.getValue === "function") {
    return definition.getValue(brush);
  }
  const value = brush?.[definition.key];
  if (value === undefined || value === null) {
    return definition.initial;
  }
  return value;
}

export function getBrushEditorControlPatch(definition, rawValue, brush) {
  if (typeof definition.commit === "function") {
    const patch = definition.commit(rawValue, brush);
    return Object.fromEntries(
      Object.entries(patch || {}).filter(([, value]) => value !== undefined),
    );
  }
  if (definition.type === "range") {
    const numeric = Number(rawValue);
    return {
      [definition.key]: clampValue(
        Number.isFinite(numeric) ? numeric : Number(definition.initial) || 0,
        Number(definition.min ?? -Infinity),
        Number(definition.max ?? Infinity),
      ),
    };
  }
  return {
    [definition.key]: rawValue,
  };
}

export function getBrushEditorControlOptions(definition, brush) {
  if (typeof definition.options === "function") {
    return definition.options(brush);
  }
  return definition.options || [];
}

export function getBrushEditorControlDisplayValue(definition, value, brush) {
  if (typeof definition.format === "function") {
    return definition.format(value, brush);
  }
  return String(value ?? "");
}

export function getBrushEditorSectionsForBrush(brush) {
  if (!brush) {
    return [];
  }
  const visibleSections = new Set(
    BRUSH_EDITOR_CONTROLS
      .filter((definition) => isBrushEditorControlVisible(definition, brush))
      .map((definition) => definition.section),
  );
  if (!isStrokeTool(brush.tool)) {
    visibleSections.add("assist");
  }
  return BRUSH_EDITOR_SECTIONS.filter((section) => visibleSections.has(section.id));
}
