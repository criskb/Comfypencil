import { clamp, lerp, noise2d } from "./brush-utils.js";

const TEXTURE_SIZE = 128;

export const BRUSH_TEXTURE_NONE = "__none__";
export const BRUSH_TEXTURE_CUSTOM = "__custom__";

const BUILTIN_TEXTURE_GENERATORS = {
  shape: [
    {
      id: "soft-oval",
      label: "Soft Oval",
      render: (u, v) => {
        const dx = (u - 0.5) / 0.34;
        const dy = (v - 0.5) / 0.44;
        const ellipse = Math.sqrt((dx * dx) + (dy * dy));
        const falloff = 1 - clamp((ellipse - 0.08) / 0.92, 0, 1);
        const tooth = 0.9 + (noise2d(u * 9.4, v * 11.1, 1.8) * 0.1);
        return Math.pow(falloff, 1.8) * tooth;
      },
    },
    {
      id: "chisel",
      label: "Chisel",
      render: (u, v) => {
        const angle = -0.58;
        const x = ((u - 0.5) * Math.cos(angle)) - ((v - 0.5) * Math.sin(angle));
        const y = ((u - 0.5) * Math.sin(angle)) + ((v - 0.5) * Math.cos(angle));
        const edgeX = 1 - clamp((Math.abs(x) - 0.17) / 0.26, 0, 1);
        const edgeY = 1 - clamp((Math.abs(y) - 0.32) / 0.16, 0, 1);
        const bevel = 0.76 + (noise2d(u * 14.2, v * 4.7, 4.2) * 0.16);
        return Math.pow(edgeX * edgeY, 1.2) * bevel;
      },
    },
    {
      id: "rake",
      label: "Rake",
      render: (u, v) => {
        const dx = (u - 0.5) / 0.36;
        const dy = (v - 0.5) / 0.44;
        const envelope = 1 - clamp((Math.sqrt((dx * dx) + (dy * dy)) - 0.02) / 0.98, 0, 1);
        const bandA = 1 - clamp(Math.abs((u - 0.24) / 0.09), 0, 1);
        const bandB = 1 - clamp(Math.abs((u - 0.5) / 0.08), 0, 1);
        const bandC = 1 - clamp(Math.abs((u - 0.76) / 0.09), 0, 1);
        const rake = Math.max(bandA, bandB, bandC);
        const breakup = 0.82 + (noise2d(u * 18.2, v * 12.4, 6.7) * 0.18);
        return envelope * rake * breakup;
      },
    },
    {
      id: "speckle-tip",
      label: "Speckle Tip",
      render: (u, v) => {
        const dx = (u - 0.5) / 0.42;
        const dy = (v - 0.5) / 0.42;
        const envelope = 1 - clamp((Math.sqrt((dx * dx) + (dy * dy)) - 0.06) / 0.94, 0, 1);
        const coarse = noise2d(u * 10.8, v * 10.8, 11.2);
        const fine = noise2d(u * 31.6, v * 31.6, 19.4);
        const freckles = clamp((coarse * 0.78) + (fine * 0.42) - 0.34, 0, 1);
        return envelope * freckles;
      },
    },
  ],
  grain: [
    {
      id: "paper",
      label: "Paper",
      render: (u, v) => {
        const coarse = noise2d(u * 9.2, v * 9.2, 2.1);
        const fine = noise2d(u * 32.7, v * 32.7, 3.7);
        const fibers = noise2d((u * 54) + (v * 8), v * 5.4, 5.6);
        return clamp((coarse * 0.42) + (fine * 0.32) + (fibers * 0.26), 0, 1);
      },
    },
    {
      id: "canvas",
      label: "Canvas",
      render: (u, v) => {
        const weaveX = Math.abs(Math.sin((u * Math.PI * 16) + (v * 0.9)));
        const weaveY = Math.abs(Math.cos((v * Math.PI * 16) - (u * 0.7)));
        const drift = noise2d(u * 12.5, v * 12.5, 9.8);
        return clamp((weaveX * 0.34) + (weaveY * 0.34) + (drift * 0.32), 0, 1);
      },
    },
    {
      id: "crossgrain",
      label: "Crossgrain",
      render: (u, v) => {
        const hatchA = Math.abs(Math.sin((u + v) * Math.PI * 18));
        const hatchB = Math.abs(Math.cos((u - v) * Math.PI * 18));
        const noise = noise2d(u * 21.7, v * 21.7, 13.1);
        return clamp((hatchA * 0.3) + (hatchB * 0.34) + (noise * 0.36), 0, 1);
      },
    },
    {
      id: "grit",
      label: "Grit",
      render: (u, v) => {
        const coarse = noise2d(u * 7.4, v * 7.4, 15.3);
        const cluster = noise2d(u * 22.1, v * 22.1, 21.7);
        const dust = noise2d(u * 43.5, v * 43.5, 25.4);
        return clamp((coarse * 0.38) + (Math.pow(cluster, 1.6) * 0.42) + (dust * 0.2), 0, 1);
      },
    },
  ],
};

const builtinTextureCache = {
  shape: new Map(),
  grain: new Map(),
};

const customTextureCache = new Map();
const customTexturePromiseCache = new Map();

function getTextureFieldMap(kind) {
  const prefix = kind === "grain" ? "grainTexture" : "shapeTexture";
  return {
    idKey: `${prefix}Id`,
    dataKey: `${prefix}Data`,
    resolvedKey: `${prefix}Resolved`,
    resolvedSourceKey: `${prefix}ResolvedSource`,
    pendingKey: `${prefix}ResolvedPending`,
  };
}

function createAlphaTextureCanvas(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const offset = (y * TEXTURE_SIZE + x) * 4;
      const u = x / Math.max(1, TEXTURE_SIZE - 1);
      const v = y / Math.max(1, TEXTURE_SIZE - 1);
      const alpha = Math.round(clamp(renderer(u, v), 0, 1) * 255);
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function buildResolvedTexture(kind, key, label, canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const alphaData = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let index = 0; index < alphaData.length; index += 1) {
    alphaData[index] = data[(index * 4) + 3];
  }

  return {
    kind,
    key,
    label,
    width: canvas.width,
    height: canvas.height,
    canvas,
    alphaData,
    previewUrl: canvas.toDataURL("image/png"),
  };
}

function ensureBuiltinTextures(kind) {
  if (builtinTextureCache[kind]?.size) {
    return;
  }

  for (const definition of BUILTIN_TEXTURE_GENERATORS[kind] || []) {
    const canvas = createAlphaTextureCanvas(definition.render);
    builtinTextureCache[kind].set(
      definition.id,
      buildResolvedTexture(kind, `builtin:${kind}:${definition.id}`, definition.label, canvas),
    );
  }
}

function getBuiltinTexture(kind, textureId) {
  ensureBuiltinTextures(kind);
  return builtinTextureCache[kind].get(String(textureId || "").trim()) || null;
}

function getBuiltinTextureDefinitions(kind) {
  ensureBuiltinTextures(kind);
  return BUILTIN_TEXTURE_GENERATORS[kind] || [];
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    image.src = url;
  });
}

function drawNormalizedTextureImage(image, kind) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const sourceWidth = image.naturalWidth || image.width || TEXTURE_SIZE;
  const sourceHeight = image.naturalHeight || image.height || TEXTURE_SIZE;
  const scale = kind === "shape"
    ? Math.min(TEXTURE_SIZE / sourceWidth, TEXTURE_SIZE / sourceHeight)
    : Math.max(TEXTURE_SIZE / sourceWidth, TEXTURE_SIZE / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.round((TEXTURE_SIZE - drawWidth) / 2);
  const offsetY = Math.round((TEXTURE_SIZE - drawHeight) / 2);
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  const imageData = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3] / 255;
    const luminance = (
      (imageData.data[index] * 0.299)
      + (imageData.data[index + 1] * 0.587)
      + (imageData.data[index + 2] * 0.114)
    ) / 255;
    const normalized = clamp(
      kind === "shape"
        ? Math.pow(luminance, 0.92) * alpha
        : Math.pow(luminance, 1.08) * alpha,
      0,
      1,
    );
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = Math.round(normalized * 255);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function loadCustomTexture(kind, cacheKey, dataUrl) {
  if (customTextureCache.has(cacheKey)) {
    return customTextureCache.get(cacheKey);
  }

  if (!customTexturePromiseCache.has(cacheKey)) {
    customTexturePromiseCache.set(
      cacheKey,
      loadImageFromUrl(dataUrl)
        .then((image) => {
          const canvas = drawNormalizedTextureImage(image, kind);
          const resolved = buildResolvedTexture(kind, cacheKey, "Custom Upload", canvas);
          customTextureCache.set(cacheKey, resolved);
          customTexturePromiseCache.delete(cacheKey);
          return resolved;
        })
        .catch((error) => {
          customTexturePromiseCache.delete(cacheKey);
          throw error;
        }),
    );
  }

  return customTexturePromiseCache.get(cacheKey);
}

export function getBrushTextureOptions(kind) {
  return [
    { value: BRUSH_TEXTURE_NONE, label: "None" },
    ...getBuiltinTextureDefinitions(kind).map((definition) => ({
      value: definition.id,
      label: definition.label,
    })),
    { value: BRUSH_TEXTURE_CUSTOM, label: "Custom Upload" },
  ];
}

export function getBrushTextureSelectionValue(kind, brush) {
  const { idKey, dataKey } = getTextureFieldMap(kind);
  if (String(brush?.[idKey] || "").trim()) {
    return String(brush[idKey]).trim();
  }
  if (String(brush?.[dataKey] || "").trim()) {
    return BRUSH_TEXTURE_CUSTOM;
  }
  return BRUSH_TEXTURE_NONE;
}

export function hasAssignedBrushTexture(kind, brush) {
  return getBrushTextureSelectionValue(kind, brush) !== BRUSH_TEXTURE_NONE;
}

export function describeBrushTextureSelection(kind, brush) {
  const { idKey, dataKey } = getTextureFieldMap(kind);
  const textureId = String(brush?.[idKey] || "").trim();
  const textureData = String(brush?.[dataKey] || "").trim();

  if (textureId) {
    const texture = getBuiltinTexture(kind, textureId);
    return {
      hasTexture: Boolean(texture),
      isCustom: false,
      label: texture?.label || "Texture",
      previewUrl: texture?.previewUrl || "",
    };
  }

  if (textureData) {
    return {
      hasTexture: true,
      isCustom: true,
      label: "Custom Upload",
      previewUrl: textureData,
    };
  }

  return {
    hasTexture: false,
    isCustom: false,
    label: "None",
    previewUrl: "",
  };
}

export function getResolvedBrushTexture(brush, kind) {
  const { resolvedKey } = getTextureFieldMap(kind);
  return brush?.[resolvedKey] || null;
}

function getBrushTextureSourceKey(kind, brush) {
  const { idKey, dataKey } = getTextureFieldMap(kind);
  const textureId = String(brush?.[idKey] || "").trim();
  if (textureId) {
    return `builtin:${kind}:${textureId}`;
  }
  const textureData = String(brush?.[dataKey] || "").trim();
  if (textureData) {
    return `custom:${kind}:${textureData}`;
  }
  return "";
}

function clearResolvedBrushTexture(kind, brush) {
  const { resolvedKey, resolvedSourceKey, pendingKey } = getTextureFieldMap(kind);
  brush[resolvedKey] = null;
  brush[resolvedSourceKey] = "";
  brush[pendingKey] = "";
}

function prepareBrushTextureForKind(kind, brush) {
  if (!brush || typeof brush !== "object") {
    return null;
  }

  const {
    idKey,
    dataKey,
    resolvedKey,
    resolvedSourceKey,
    pendingKey,
  } = getTextureFieldMap(kind);
  const nextSourceKey = getBrushTextureSourceKey(kind, brush);
  if (!nextSourceKey) {
    clearResolvedBrushTexture(kind, brush);
    return null;
  }

  if (brush[resolvedSourceKey] === nextSourceKey && brush[resolvedKey]) {
    return null;
  }

  const textureId = String(brush[idKey] || "").trim();
  if (textureId) {
    const resolved = getBuiltinTexture(kind, textureId);
    brush[resolvedKey] = resolved;
    brush[resolvedSourceKey] = nextSourceKey;
    brush[pendingKey] = "";
    return null;
  }

  if (customTextureCache.has(nextSourceKey)) {
    brush[resolvedKey] = customTextureCache.get(nextSourceKey);
    brush[resolvedSourceKey] = nextSourceKey;
    brush[pendingKey] = "";
    return null;
  }

  if (brush[pendingKey] === nextSourceKey && customTexturePromiseCache.has(nextSourceKey)) {
    return customTexturePromiseCache.get(nextSourceKey);
  }

  const textureData = String(brush[dataKey] || "").trim();
  if (!textureData) {
    clearResolvedBrushTexture(kind, brush);
    return null;
  }

  brush[pendingKey] = nextSourceKey;
  return loadCustomTexture(kind, nextSourceKey, textureData)
    .then((resolved) => {
      if (getBrushTextureSourceKey(kind, brush) === nextSourceKey) {
        brush[resolvedKey] = resolved;
        brush[resolvedSourceKey] = nextSourceKey;
      }
      if (brush[pendingKey] === nextSourceKey) {
        brush[pendingKey] = "";
      }
      return resolved;
    })
    .catch(() => {
      if (brush[pendingKey] === nextSourceKey) {
        brush[pendingKey] = "";
      }
      return null;
    });
}

export function prepareBrushTextureState(brush, onResolved = null) {
  const pendingLoads = [
    prepareBrushTextureForKind("shape", brush),
    prepareBrushTextureForKind("grain", brush),
  ].filter(Boolean);

  if (pendingLoads.length && typeof onResolved === "function") {
    Promise.allSettled(pendingLoads).then(() => onResolved());
  }
}

export async function normalizeUploadedBrushTexture(file, kind) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
    const canvas = drawNormalizedTextureImage(image, kind);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function sampleBrushTexture(texture, u, v) {
  if (!texture?.alphaData?.length || !texture.width || !texture.height) {
    return 1;
  }

  const wrappedX = ((u % 1) + 1) % 1;
  const wrappedY = ((v % 1) + 1) % 1;
  const x = wrappedX * Math.max(0, texture.width - 1);
  const y = wrappedY * Math.max(0, texture.height - 1);
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.min(texture.width - 1, left + 1);
  const bottom = Math.min(texture.height - 1, top + 1);
  const tx = x - left;
  const ty = y - top;

  const sample = (sampleX, sampleY) => texture.alphaData[(sampleY * texture.width) + sampleX] / 255;
  const topValue = lerp(sample(left, top), sample(right, top), tx);
  const bottomValue = lerp(sample(left, bottom), sample(right, bottom), tx);
  return lerp(topValue, bottomValue, ty);
}

export function drawBrushShapeTexture(ctx, texture, size, scale = 1) {
  if (!texture?.canvas || !size) {
    return;
  }

  const drawSize = Math.max(8, size * clamp(scale || 1, 0.35, 2.5));
  const offset = (size - drawSize) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(texture.canvas, offset, offset, drawSize, drawSize);
}
