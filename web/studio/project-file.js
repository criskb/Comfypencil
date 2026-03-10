export const PROJECT_FILE_FORMAT = "comfypencil.pencilstudio";
export const PROJECT_FILE_VERSION = 2;
export const PROJECT_FILE_EXTENSION = ".pencilstudio";
export const PROJECT_FILE_MIME = "application/x-comfypencil-studio+json";
const SUPPORTED_PROJECT_FILE_VERSIONS = new Set([1, PROJECT_FILE_VERSION]);

function sanitizeStem(name) {
  return String(name || "untitled_sketch")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "") || "untitled_sketch";
}

export function validateProjectBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("Project file must contain an object.");
  }
  if (String(bundle.format || "") !== PROJECT_FILE_FORMAT) {
    throw new Error("Unsupported project file format.");
  }
  if (!SUPPORTED_PROJECT_FILE_VERSIONS.has(Number(bundle.version || 0))) {
    throw new Error("Unsupported project file version.");
  }
  if (!bundle.document || typeof bundle.document !== "object" || Array.isArray(bundle.document)) {
    throw new Error("Project file is missing document metadata.");
  }
  if (!Array.isArray(bundle.document.layers)) {
    throw new Error("Project file is missing layer metadata.");
  }
  if (!bundle.layerImages || typeof bundle.layerImages !== "object" || Array.isArray(bundle.layerImages)) {
    throw new Error("Project file is missing layer image data.");
  }
  const layerMaterialImages = bundle.layerMaterialImages;
  if (layerMaterialImages != null && (typeof layerMaterialImages !== "object" || Array.isArray(layerMaterialImages))) {
    throw new Error("Project file material image data must be an object when provided.");
  }
  return {
    ...bundle,
    layerImages: { ...bundle.layerImages },
    layerMaterialImages: { ...(layerMaterialImages || {}) },
  };
}

export async function readProjectBundleFile(file) {
  const text = await file.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Project file is not valid JSON: ${error.message}`);
  }
  return validateProjectBundle(parsed);
}

export function createProjectBundleBlob(bundle) {
  return new Blob([JSON.stringify(validateProjectBundle(bundle), null, 2)], {
    type: PROJECT_FILE_MIME,
  });
}

export function getProjectBundleFilename(name) {
  return `${sanitizeStem(name)}${PROJECT_FILE_EXTENSION}`;
}
