import {
  angleFromPoints,
  clamp,
  darkenColor,
  hexToColor,
  hsvToRgb,
  lightenColor,
  mixColor,
  noise2d,
  pressureScale,
  rgbaFromHex,
  rgbToHex,
  rgbToHsv,
} from "./brush-utils.js";
import {
  drawBrushShapeTexture,
  getResolvedBrushTexture,
  sampleBrushTexture,
} from "./brush-textures.js";

const colorStampBuffer = document.createElement("canvas");
const colorStampBufferCtx = colorStampBuffer.getContext("2d", { willReadFrequently: true });
const materialStampBuffer = document.createElement("canvas");
const materialStampBufferCtx = materialStampBuffer.getContext("2d", { willReadFrequently: true });

function resolveStrokeAngle(stroke, point) {
  return angleFromPoints(stroke?.lastRenderedPoint || stroke?.lastPoint || stroke?.startPoint, point, stroke?.lastAngle ?? 0);
}

function lerpAngle(fromAngle, toAngle, amount) {
  const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
  return fromAngle + (delta * clamp(amount, 0, 1));
}

function randomSigned() {
  return (Math.random() * 2) - 1;
}

function rgbaFromChannels(red, green, blue, alpha = 1) {
  return `rgba(${clamp(Math.round(red), 0, 255)}, ${clamp(Math.round(green), 0, 255)}, ${clamp(Math.round(blue), 0, 255)}, ${clamp(alpha, 0, 1)})`;
}

export function packBrushMaterial(brush, alpha = 1) {
  const materialDepth = clamp(brush?.materialDepth ?? 0, 0, 1);
  const materialShine = clamp(brush?.materialShine ?? 0, 0, 1);
  const materialRoughness = clamp(brush?.materialRoughness ?? 0.5, 0, 1);
  const coverage = clamp(alpha, 0, 1);
  return {
    r: Math.round(materialDepth * 255),
    g: Math.round(materialRoughness * 255),
    b: Math.round(materialShine * 255),
    a: Math.round(coverage * 255),
  };
}

function ensureStampBuffer(buffer, size) {
  const nextSize = Math.max(8, Math.ceil(size));
  if (buffer.width !== nextSize) {
    buffer.width = nextSize;
  }
  if (buffer.height !== nextSize) {
    buffer.height = nextSize;
  }
  return nextSize;
}

function createStampMaskGradient(ctx, center, innerRadius, outerRadius, hardness) {
  const gradient = ctx.createRadialGradient(center, center, innerRadius, center, center, outerRadius);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(clamp(hardness, 0.02, 0.98), "rgba(255, 255, 255, 0.92)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  return gradient;
}

function drawTexturedColorStamp(ctx, {
  texture,
  shapeTextureScale,
  stampRadius,
  innerRadius,
  workingHardness,
  stampColorHex,
  stampAlphaLocal,
  compositeOperation,
}) {
  const size = ensureStampBuffer(colorStampBuffer, (stampRadius * 2) + 6);
  const center = size / 2;
  colorStampBufferCtx.clearRect(0, 0, size, size);
  drawBrushShapeTexture(colorStampBufferCtx, texture, size, shapeTextureScale);
  colorStampBufferCtx.globalCompositeOperation = "destination-in";
  colorStampBufferCtx.fillStyle = createStampMaskGradient(colorStampBufferCtx, center, innerRadius, stampRadius, workingHardness);
  colorStampBufferCtx.fillRect(0, 0, size, size);
  colorStampBufferCtx.globalCompositeOperation = "source-in";
  colorStampBufferCtx.fillStyle = rgbaFromHex(stampColorHex, stampAlphaLocal);
  colorStampBufferCtx.fillRect(0, 0, size, size);
  colorStampBufferCtx.globalCompositeOperation = "source-over";

  ctx.globalCompositeOperation = compositeOperation;
  ctx.drawImage(colorStampBuffer, -center, -center);
}

function drawTexturedMaterialStamp(materialCtx, {
  brush,
  texture,
  shapeTextureScale,
  stampRadius,
  innerRadius,
  workingHardness,
  stampAlphaLocal,
}) {
  const size = ensureStampBuffer(materialStampBuffer, (stampRadius * 2) + 6);
  const center = size / 2;
  materialStampBufferCtx.clearRect(0, 0, size, size);
  drawBrushShapeTexture(materialStampBufferCtx, texture, size, shapeTextureScale);
  materialStampBufferCtx.globalCompositeOperation = "destination-in";
  materialStampBufferCtx.fillStyle = createStampMaskGradient(materialStampBufferCtx, center, innerRadius, stampRadius, workingHardness);
  materialStampBufferCtx.fillRect(0, 0, size, size);
  materialStampBufferCtx.globalCompositeOperation = "source-in";

  if (brush.tool === "eraser") {
    materialStampBufferCtx.fillStyle = rgbaFromChannels(255, 255, 255, stampAlphaLocal);
  } else {
    const materialPixel = packBrushMaterial(brush, stampAlphaLocal);
    materialStampBufferCtx.fillStyle = rgbaFromChannels(
      materialPixel.r,
      materialPixel.g,
      materialPixel.b,
      materialPixel.a / 255,
    );
  }
  materialStampBufferCtx.fillRect(0, 0, size, size);
  materialStampBufferCtx.globalCompositeOperation = "source-over";
  materialCtx.drawImage(materialStampBuffer, -center, -center);
}

function grainSampleForBrush(brush, point, travel, stampIndex) {
  const grainMovement = String(brush.grainMovement || "rolling");
  const grainScale = clamp(brush.grainScale ?? 0.45, 0, 1);
  const scale = 8 + (grainScale * 92);
  const x = grainMovement === "static"
    ? point.x / scale
    : (travel / (4 + grainScale * 18)) + (point.x / (scale * 1.8));
  const y = grainMovement === "drift"
    ? (point.y / scale) + (travel / (10 + grainScale * 22))
    : point.y / (grainMovement === "static" ? scale : scale * 2.2);
  const grainTexture = getResolvedBrushTexture(brush, "grain");
  if (grainTexture) {
    return sampleBrushTexture(
      grainTexture,
      x + (stampIndex * 0.013),
      y + (stampIndex * 0.007),
    );
  }
  return noise2d(x + stampIndex * 0.73, y + stampIndex * 0.29, grainScale * 17);
}

function applyColorDynamics(color, brush, point, travel, stampIndex) {
  if (brush.tool !== "brush") {
    return color;
  }

  const hsv = rgbToHsv(color);
  const stampSeed = noise2d(
    point.x * 0.018 + stampIndex * 0.37,
    point.y * 0.018 + travel * 0.004,
    stampIndex + travel * 0.002,
  );
  const stampSigned = (stampSeed * 2) - 1;
  const strokeWave = Math.sin((travel / Math.max(24, (brush.size || 1) * 3.4)) + (stampIndex * 0.22));

  hsv.h = ((hsv.h
    + (stampSigned * clamp(brush.hueStampJitter ?? 0, 0, 1) * 0.12)
    + (strokeWave * clamp(brush.hueStrokeJitter ?? 0, 0, 1) * 0.06)) % 1 + 1) % 1;
  hsv.s = clamp(
    hsv.s
      + (stampSigned * clamp(brush.saturationStampJitter ?? 0, 0, 1) * 0.18)
      + (strokeWave * clamp(brush.saturationStrokeJitter ?? 0, 0, 1) * 0.08),
    0,
    1,
  );
  hsv.v = clamp(
    hsv.v
      + (stampSigned * clamp(brush.brightnessStampJitter ?? 0, 0, 1) * 0.16)
      + (strokeWave * clamp(brush.brightnessStrokeJitter ?? 0, 0, 1) * 0.08),
    0,
    1,
  );
  return hsvToRgb(hsv);
}

export function stampBrushDab(ctx, {
  brush,
  point,
  pressure,
  stroke,
  sampleCompositeColor,
  initial = false,
  tilt = null,
  materialCtx = null,
}) {
  const pressureValue = clamp(pressure || 1, 0.08, 1.4);
  const pressureSize = pressureScale(pressureValue, brush.pressureSize ?? 0.6);
  const pressureOpacity = pressureScale(pressureValue, brush.pressureOpacity ?? 0.35);
  const velocity = clamp(stroke?.smoothedVelocity ?? 0, 0, 4);
  const speedThin = clamp(brush.speedThin ?? 0, 0, 1);
  const speedOpacity = clamp(brush.speedOpacity ?? 0, 0, 1);
  const speedSizeScale = 1 - clamp(velocity / 1.6, 0, 1) * speedThin * 0.38;
  const speedOpacityScale = 1 - clamp(velocity / 1.8, 0, 1) * speedOpacity * 0.24;
  const tiltState = tilt || stroke?.tilt || { magnitude: 0, angle: 0 };
  const tiltMagnitude = clamp(tiltState.magnitude ?? 0, 0, 1);
  const tiltAngle = Number.isFinite(tiltState.angle) ? tiltState.angle : 0;

  const minimumSize = clamp(brush.minimumSize ?? 0, 0, 1);
  const tiltSize = clamp(brush.tiltSize ?? 0, 0, 1);
  const strokeFalloff = clamp(brush.strokeFalloff ?? 0, 0, 1);
  const baseBrushSize = Math.max(1, brush.size || 1);
  const baseSize = Math.max(
    Math.max(1, baseBrushSize * minimumSize * 0.24),
    baseBrushSize * pressureSize * speedSizeScale * (1 + tiltMagnitude * tiltSize * 0.42),
  );

  const startTaper = clamp(brush.startTaper ?? brush.taper ?? 0, 0, 1);
  const endTaper = clamp(brush.endTaper ?? brush.taper ?? 0, 0, 1);
  const taperOpacity = clamp(brush.taperOpacity ?? 0, 0, 1);
  const tipSharpness = clamp(brush.tipSharpness ?? 0.5, 0, 1);
  const travel = stroke?.distance ?? 0;
  const startRamp = clamp(travel / Math.max(2, baseSize * (0.7 + startTaper * 4.8)), 0, 1);
  const releaseRamp = clamp(pressureValue * (0.75 + tipSharpness * 0.25), 0.05, 1);
  const startSizeScale = 1 - ((1 - startRamp) * startTaper * 0.65);
  const endSizeScale = 1 - ((1 - releaseRamp) * endTaper * 0.62);
  const falloffScale = 1 - (strokeFalloff * clamp(travel / Math.max(baseBrushSize * 18, 24), 0, 1) * 0.42);

  const sizeJitter = clamp(brush.sizeJitter ?? 0, 0, 1);
  const opacityJitter = clamp(brush.opacityJitter ?? 0, 0, 1);
  const flowJitter = clamp(brush.flowJitter ?? 0, 0, 1);
  const flow = clamp((brush.flow ?? 0.3) * (1 + randomSigned() * flowJitter * 0.24), 0.01, 1);
  const hardness = clamp(brush.hardness ?? 0.7, 0.01, 1);
  const grain = clamp(brush.grain ?? 0, 0, 1);
  const grainDepth = clamp(brush.grainDepth ?? 0.35, 0, 1);
  const grainContrast = clamp(brush.grainContrast ?? 0.5, 0, 1);
  const scatter = clamp(brush.scatter ?? 0, 0, 1);
  const density = clamp(brush.density ?? 0.55, 0, 1);
  const roundness = clamp(brush.roundness ?? 1, 0.24, 1);
  const wetMix = clamp(brush.wetMix ?? 0, 0, 1);
  const rotationJitter = clamp(brush.rotationJitter ?? 0.06, 0, 1);
  const maximumOpacity = clamp(brush.maximumOpacity ?? 1, 0.08, 1);

  let color = brush.color;
  let compositeOperation = "source-over";
  let workingHardness = hardness;
  let stampAlpha = clamp(
    (brush.opacity ?? 1) * flow * pressureOpacity * speedOpacityScale * falloffScale * (1 - ((1 - releaseRamp) * taperOpacity * endTaper * 0.48)),
    0.02,
    maximumOpacity,
  );

  const renderMode = String(brush.renderMode || "build");
  switch (renderMode) {
    case "uniform":
      workingHardness = clamp(workingHardness * 1.08, 0.06, 0.98);
      stampAlpha *= 0.94;
      break;
    case "glaze":
      workingHardness *= 0.78;
      stampAlpha *= 0.74;
      break;
    case "intense":
      workingHardness = clamp(workingHardness * 1.18, 0.08, 0.99);
      stampAlpha *= 1.08;
      break;
    case "soft":
      workingHardness *= 0.56;
      stampAlpha *= 0.64;
      break;
    default:
      break;
  }
  stampAlpha = clamp(stampAlpha * (0.72 + clamp(brush.renderIntensity ?? 0.5, 0, 1) * 0.46), 0.02, maximumOpacity);
  if (initial) {
    stampAlpha = clamp(stampAlpha * 0.92, 0.02, maximumOpacity);
  }

  if (brush.tool === "eraser") {
    compositeOperation = "destination-out";
    color = "#000000";
  } else if (brush.tool === "blend") {
    const sampled = sampleCompositeColor(point.x, point.y, Math.max(2, Math.round(baseSize * 0.4)));
    const carried = stroke?.pickupColor || sampled;
    const smudgeStrength = clamp(brush.smudgeStrength ?? 0.6, 0.05, 1);
    const stampColor = mixColor(sampled, carried, 0.42 + smudgeStrength * 0.38);
    color = rgbToHex(stampColor);
    workingHardness = Math.max(0.05, hardness * 0.58);
    stampAlpha = clamp((brush.opacity ?? 0.28) * (0.18 + smudgeStrength * 0.42), 0.04, 0.62);
    if (stroke) {
      stroke.pickupColor = mixColor(sampled, carried, 0.56 + smudgeStrength * 0.22);
    }
  } else if (wetMix > 0.02) {
    const sampled = sampleCompositeColor(point.x, point.y, Math.max(2, Math.round(baseSize * 0.35)));
    const carried = stroke?.pickupColor || sampled;
    const dilution = clamp(brush.wetDilution ?? 0.35, 0, 1);
    const charge = clamp(brush.wetCharge ?? 0.5, 0, 1);
    const attack = clamp(brush.wetAttack ?? 0.4, 0, 1);
    const pull = clamp(brush.wetPull ?? 0.35, 0, 1);
    const grade = clamp(brush.wetGrade ?? 0.4, 0, 1);
    const wetBlur = clamp(brush.wetBlur ?? 0.14, 0, 1);
    const targetColor = hexToColor(brush.color, Math.round(stampAlpha * 255));
    const dilutedTarget = mixColor(targetColor, sampled, wetMix * (0.24 + dilution * 0.38 + attack * 0.18));
    const glazedColor = mixColor(dilutedTarget, carried, wetMix * (0.16 + pull * 0.24 + grade * 0.18));
    color = rgbToHex(glazedColor);
    stampAlpha = clamp(stampAlpha * (0.9 + charge * 0.14 - dilution * 0.12), 0.02, maximumOpacity);
    workingHardness = clamp(workingHardness * (0.92 - wetBlur * 0.38), 0.04, 1);
    if (stroke) {
      stroke.pickupColor = mixColor(carried, targetColor, 0.12 + wetMix * 0.18 + charge * 0.12);
    }
  }

  let resolvedColor = hexToColor(color, Math.round(stampAlpha * 255));
  resolvedColor = applyColorDynamics(resolvedColor, brush, point, travel, 0);

  const luminanceBlend = clamp(brush.luminanceBlend ?? 0, 0, 1);
  if (luminanceBlend > 0.02 && brush.tool === "brush") {
    const sampled = sampleCompositeColor(point.x, point.y, Math.max(2, Math.round(baseSize * 0.3)));
    const luminance = ((sampled.r + sampled.g + sampled.b) / 3) / 255;
    const luminanceColor = {
      r: resolvedColor.r * (0.62 + luminance * 0.38),
      g: resolvedColor.g * (0.62 + luminance * 0.38),
      b: resolvedColor.b * (0.62 + luminance * 0.38),
      a: resolvedColor.a,
    };
    resolvedColor = mixColor(resolvedColor, luminanceColor, luminanceBlend * 0.3);
  }

  const shapeCount = clamp(brush.shapeCount ?? 0, 0, 1);
  const shapeCountJitter = clamp(brush.shapeCountJitter ?? 0, 0, 1);
  const speedScatter = clamp(brush.speedScatter ?? 0, 0, 1);
  const strokeJitter = clamp(brush.strokeJitter ?? 0, 0, 1);
  const tiltScatter = clamp(brush.tiltScatter ?? 0, 0, 1);
  const stampDensity = (grain * 0.54) + (scatter * 0.78) + (density * 0.78) + (shapeCount * 0.62);
  const countJitter = Math.round(Math.abs(randomSigned()) * shapeCountJitter * 3);
  const baseStampCount = Math.max(1, Math.min(10, 1 + Math.round(stampDensity * 3.2) + Math.round(shapeCount * 3) - countJitter));
  const stampCount = initial ? 1 : baseStampCount;
  const baseSizeWithJitter = baseSize * startSizeScale * endSizeScale * falloffScale * (1 + randomSigned() * sizeJitter * 0.18) * (initial ? 0.95 : 1);
  const radius = Math.max(0.5, baseSizeWithJitter / 2);
  const scatterDistance = radius * (
    (scatter * (initial ? 0.3 + density * 0.18 : 0.58 + density * 0.34))
    + (strokeJitter * 0.42)
    + (tiltMagnitude * tiltScatter * 0.28)
    + (velocity * speedScatter * 0.14)
  );
  const azimuth = clamp(brush.shapeAzimuth ?? 1, 0, 1);
  const rotationOffset = ((Number(brush.stampRotation) || 0) * Math.PI) / 180;
  const baseStrokeAngle = resolveStrokeAngle(stroke, point);
  const baseAngle = lerpAngle(rotationOffset, baseStrokeAngle + rotationOffset, azimuth);
  const resolvedAngle = tiltMagnitude > 0.001
    ? lerpAngle(baseAngle, tiltAngle + rotationOffset, clamp(brush.tiltRotation ?? 0, 0, 1) * tiltMagnitude)
    : baseAngle;

  const wetEdges = clamp(brush.wetEdges ?? 0, 0, 1);
  const burntEdges = clamp(brush.burntEdges ?? 0, 0, 1);
  const materialDepth = clamp(brush.materialDepth ?? 0, 0, 1);
  const materialShine = clamp(brush.materialShine ?? 0, 0, 1);
  const materialRoughness = clamp(brush.materialRoughness ?? 0.5, 0, 1);
  const tiltOpacity = clamp(brush.tiltOpacity ?? 0, 0, 1);
  const shapeTexture = getResolvedBrushTexture(brush, "shape");
  const shapeTextureScale = clamp(brush.shapeTextureScale ?? 1, 0.35, 2.5);

  for (let index = 0; index < stampCount; index += 1) {
    const angleNoise = initial && index === 0
      ? 0
      : randomSigned() * (rotationJitter * 0.58 + grain * 0.18);
    const stampAngle = resolvedAngle + angleNoise;
    const tangentX = Math.cos(stampAngle);
    const tangentY = Math.sin(stampAngle);
    const normalX = -tangentY;
    const normalY = tangentX;
    const perpendicularDrift = index === 0 ? 0 : randomSigned() * scatterDistance;
    const forwardDrift = index === 0 ? 0 : randomSigned() * scatterDistance * 0.42;
    const stampX = point.x + (normalX * perpendicularDrift) + (tangentX * forwardDrift);
    const stampY = point.y + (normalY * perpendicularDrift) + (tangentY * forwardDrift);

    const grainSample = grainSampleForBrush(brush, point, travel, index);
    const grainMask = Math.pow(grainSample, 2.2 - grainContrast * 1.7);
    const grainOpacityDrop = grain * grainDepth * (1 - grainMask) * 0.28;
    const stampRadius = Math.max(
      0.5,
      radius * (
        index === 0
          ? 1
          : 1 - Math.random() * (grain * 0.2 + scatter * 0.18 + density * 0.1 + sizeJitter * 0.14)
      ),
    );
    const alphaScale = index === 0
      ? 1 - grain * 0.15
      : (grain * 0.34 + scatter * 0.14 + density * 0.22 + shapeCount * 0.14) / Math.max(1, stampCount - 1);
    const stampRoundness = clamp(
      roundness
        + (randomSigned() * grain * 0.12)
        - (tiltMagnitude * tiltSize * 0.08),
      0.22,
      1,
    );
    const innerRadius = stampRadius * clamp(
      workingHardness * (0.18 + stampRoundness * 0.16 + tipSharpness * 0.1),
      0.04,
      0.92,
    );

    const stampColor = applyColorDynamics(resolvedColor, brush, { x: stampX, y: stampY }, travel, index);
    const stampColorHex = rgbToHex(stampColor);
    const stampAlphaLocal = clamp(
      stampAlpha
        * alphaScale
        * (1 - grainOpacityDrop)
        * (1 - tiltMagnitude * tiltOpacity * 0.2)
        * (1 + randomSigned() * opacityJitter * 0.24),
      0.02,
      maximumOpacity,
    );

    ctx.save();
    ctx.translate(stampX, stampY);
    ctx.rotate(stampAngle);
    ctx.scale(1, stampRoundness);
    if (shapeTexture) {
      drawTexturedColorStamp(ctx, {
        texture: shapeTexture,
        shapeTextureScale,
        stampRadius,
        innerRadius,
        workingHardness,
        stampColorHex,
        stampAlphaLocal,
        compositeOperation,
      });
    } else {
      const gradient = ctx.createRadialGradient(0, 0, innerRadius, 0, 0, stampRadius);
      gradient.addColorStop(0, rgbaFromHex(stampColorHex, stampAlphaLocal));
      gradient.addColorStop(clamp(workingHardness, 0.02, 0.98), rgbaFromHex(stampColorHex, stampAlphaLocal * 0.92));
      gradient.addColorStop(1, rgbaFromHex(stampColorHex, 0));
      ctx.globalCompositeOperation = compositeOperation;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, stampRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (wetEdges > 0.02 && compositeOperation === "source-over") {
      const edgeGradient = ctx.createRadialGradient(0, 0, stampRadius * 0.62, 0, 0, stampRadius * 1.04);
      edgeGradient.addColorStop(0, rgbaFromHex(stampColorHex, 0));
      edgeGradient.addColorStop(0.78, rgbaFromHex(stampColorHex, stampAlphaLocal * wetEdges * 0.12));
      edgeGradient.addColorStop(1, rgbaFromHex(stampColorHex, 0));
      ctx.fillStyle = edgeGradient;
      ctx.beginPath();
      ctx.arc(0, 0, stampRadius * 1.04, 0, Math.PI * 2);
      ctx.fill();
    }

    if (burntEdges > 0.02 && compositeOperation === "source-over") {
      const edgeColor = rgbToHex(darkenColor(stampColor, 0.4 + burntEdges * 0.22));
      const edgeGradient = ctx.createRadialGradient(0, 0, stampRadius * 0.66, 0, 0, stampRadius);
      edgeGradient.addColorStop(0, rgbaFromHex(edgeColor, 0));
      edgeGradient.addColorStop(0.86, rgbaFromHex(edgeColor, stampAlphaLocal * burntEdges * 0.22));
      edgeGradient.addColorStop(1, rgbaFromHex(edgeColor, 0));
      ctx.fillStyle = edgeGradient;
      ctx.beginPath();
      ctx.arc(0, 0, stampRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    if ((materialDepth > 0.02 || materialShine > 0.02) && compositeOperation === "source-over") {
      const highlightColor = rgbToHex(lightenColor(stampColor, 0.2 + materialShine * 0.36));
      const shadowColor = rgbToHex(darkenColor(stampColor, 0.26 + materialDepth * 0.24));
      const lighting = ctx.createLinearGradient(-stampRadius, -stampRadius, stampRadius, stampRadius);
      lighting.addColorStop(0, rgbaFromHex(highlightColor, stampAlphaLocal * materialShine * (0.16 - materialRoughness * 0.06)));
      lighting.addColorStop(0.48, rgbaFromHex(highlightColor, 0));
      lighting.addColorStop(0.52, rgbaFromHex(shadowColor, 0));
      lighting.addColorStop(1, rgbaFromHex(shadowColor, stampAlphaLocal * materialDepth * (0.18 + materialRoughness * 0.08)));
      ctx.fillStyle = lighting;
      ctx.beginPath();
      ctx.arc(0, 0, stampRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (materialCtx && brush.tool !== "blend") {
      materialCtx.save();
      materialCtx.translate(stampX, stampY);
      materialCtx.rotate(stampAngle);
      materialCtx.scale(1, stampRoundness);
      materialCtx.globalCompositeOperation = brush.tool === "eraser" ? "destination-out" : "source-over";

      if (shapeTexture) {
        drawTexturedMaterialStamp(materialCtx, {
          brush,
          texture: shapeTexture,
          shapeTextureScale,
          stampRadius,
          innerRadius,
          workingHardness,
          stampAlphaLocal,
        });
      } else {
        const materialGradient = materialCtx.createRadialGradient(0, 0, innerRadius, 0, 0, stampRadius);
        if (brush.tool === "eraser") {
          materialGradient.addColorStop(0, rgbaFromChannels(255, 255, 255, stampAlphaLocal));
          materialGradient.addColorStop(clamp(workingHardness, 0.02, 0.98), rgbaFromChannels(255, 255, 255, stampAlphaLocal * 0.92));
          materialGradient.addColorStop(1, rgbaFromChannels(255, 255, 255, 0));
        } else {
          const materialPixel = packBrushMaterial(brush, stampAlphaLocal);
          const materialAlpha = materialPixel.a / 255;
          materialGradient.addColorStop(0, rgbaFromChannels(materialPixel.r, materialPixel.g, materialPixel.b, materialAlpha));
          materialGradient.addColorStop(
            clamp(workingHardness, 0.02, 0.98),
            rgbaFromChannels(materialPixel.r, materialPixel.g, materialPixel.b, materialAlpha * 0.94),
          );
          materialGradient.addColorStop(1, rgbaFromChannels(materialPixel.r, materialPixel.g, materialPixel.b, 0));
        }
        materialCtx.fillStyle = materialGradient;
        materialCtx.beginPath();
        materialCtx.arc(0, 0, stampRadius, 0, Math.PI * 2);
        materialCtx.fill();
      }
      materialCtx.restore();
    }

    ctx.restore();
  }

  if (stroke) {
    stroke.lastAngle = resolvedAngle;
    stroke.lastRenderedPoint = point;
  }
}
