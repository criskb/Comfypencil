import { stampBrushDab } from "./brush-stamp.js";

export function sampleCanvasColor(ctx, canvas, x, y, radius = 2) {
  const sampleRadius = Math.max(0, Math.floor(radius));
  const left = Math.max(0, Math.min(canvas.width - 1, Math.floor(x) - sampleRadius));
  const top = Math.max(0, Math.min(canvas.height - 1, Math.floor(y) - sampleRadius));
  const right = Math.max(0, Math.min(canvas.width - 1, Math.floor(x) + sampleRadius));
  const bottom = Math.max(0, Math.min(canvas.height - 1, Math.floor(y) + sampleRadius));
  const width = Math.max(1, right - left + 1);
  const height = Math.max(1, bottom - top + 1);
  const { data } = ctx.getImageData(left, top, width, height);

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalA = 0;
  let weight = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const currentWeight = Math.max(alpha, 0.08);
    totalR += data[index] * currentWeight;
    totalG += data[index + 1] * currentWeight;
    totalB += data[index + 2] * currentWeight;
    totalA += data[index + 3];
    weight += currentWeight;
  }

  if (!weight) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: totalR / weight,
    g: totalG / weight,
    b: totalB / weight,
    a: totalA / Math.max(1, data.length / 4),
  };
}

export function paintSampleSurface(ctx, width, height, { background = "#13161c", grid = false } = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const paperGradient = ctx.createLinearGradient(0, 0, width, height);
  paperGradient.addColorStop(0, "rgba(255, 255, 255, 0.09)");
  paperGradient.addColorStop(1, "rgba(255, 255, 255, 0.02)");
  ctx.fillStyle = paperGradient;
  ctx.fillRect(0, 0, width, height);

  if (!grid) {
    return;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

export function getBrushPreviewSignature(brush, {
  width,
  height,
  background = "#13161c",
  sampleColor = brush.color || "#f5f7fb",
  grid = false,
  compact = false,
} = {}) {
  return JSON.stringify({
    brush: Object.fromEntries(
      Object.entries(brush || {}).filter(([, value]) => typeof value !== "function"),
    ),
    color: sampleColor,
    width: Math.round(width || 0),
    height: Math.round(height || 0),
    background,
    grid,
    compact,
  });
}

function sampleCubicBezierPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const tSquared = t * t;
  return {
    x: (inverseSquared * inverse * start.x)
      + (3 * inverseSquared * t * controlA.x)
      + (3 * inverse * tSquared * controlB.x)
      + (tSquared * t * end.x),
    y: (inverseSquared * inverse * start.y)
      + (3 * inverseSquared * t * controlA.y)
      + (3 * inverse * tSquared * controlB.y)
      + (tSquared * t * end.y),
  };
}

export function renderBrushStrokeSample(canvas, brush, {
  width = 320,
  height = 180,
  background = "#13161c",
  sampleColor = brush.color || "#f5f7fb",
  grid = false,
  compact = false,
} = {}) {
  const strokeTool = ["brush", "eraser", "blend"].includes(brush.tool);
  const safeWidth = Math.max(120, Math.round(width));
  const safeHeight = Math.max(compact ? 124 : 64, Math.round(height));
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  canvas.style.removeProperty("width");
  canvas.style.removeProperty("height");

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  paintSampleSurface(ctx, safeWidth, safeHeight, { background, grid });

  if (!strokeTool) {
    return false;
  }

  const maxPreviewSize = Math.max(6, safeHeight * (compact ? 0.56 : 0.28));
  const brushSize = Math.max(1, Number(brush.size) || 1);
  const previewScale = Math.max(0.45, Math.min(1.8, Number(brush.previewScale) || 1));
  const sizeScale = Math.min(1, maxPreviewSize / brushSize);
  const previewBrush = {
    ...brush,
    color: sampleColor,
    size: Math.max(1, brushSize * sizeScale * previewScale),
    spacing: Math.min(Math.max(0.04, brush.spacing ?? 0.1), compact ? 0.08 : 0.1),
    scatter: Math.min(Math.max(0, brush.scatter ?? 0), compact ? 0.16 : 0.24),
    grain: Math.min(Math.max(0, brush.grain ?? 0), compact ? 0.16 : 0.24),
    rotationJitter: Math.min(Math.max(0, brush.rotationJitter ?? 0.05), compact ? 0.035 : 0.06),
    sizeJitter: Math.min(Math.max(0, brush.sizeJitter ?? 0), compact ? 0.05 : 0.08),
    opacityJitter: Math.min(Math.max(0, brush.opacityJitter ?? 0), compact ? 0.04 : 0.08),
    flowJitter: Math.min(Math.max(0, brush.flowJitter ?? 0), compact ? 0.03 : 0.06),
    strokeJitter: Math.min(Math.max(0, brush.strokeJitter ?? 0), compact ? 0.02 : 0.05),
    shapeCount: Math.min(Math.max(0, brush.shapeCount ?? 0), compact ? 0.12 : 0.18),
    shapeCountJitter: Math.min(Math.max(0, brush.shapeCountJitter ?? 0), compact ? 0.03 : 0.06),
    speedScatter: Math.min(Math.max(0, brush.speedScatter ?? 0), compact ? 0.08 : 0.12),
  };
  const verticalRadius = Math.max(4, (previewBrush.size * Math.max(0.24, previewBrush.roundness ?? 1)) / 2);
  const scatterPad = previewBrush.size * Math.min(0.36, Math.max(0, previewBrush.scatter ?? 0)) * (compact ? 0.38 : 0.52);
  const horizontalInset = Math.min(
    safeWidth * (compact ? 0.1 : 0.2),
    Math.max(compact ? 18 : 44, previewBrush.size * (compact ? 0.84 : 1.2)),
  );
  const verticalInset = Math.min(
    safeHeight * (compact ? 0.18 : 0.28),
    Math.max(compact ? 18 : 14, verticalRadius + scatterPad + (compact ? 10 : 6)),
  );
  const startX = horizontalInset;
  const endInset = horizontalInset;
  const drawableWidth = Math.max(24, safeWidth - startX - endInset);
  const drawableHeight = Math.max(compact ? 68 : 18, safeHeight - (verticalInset * 2));
  const baseline = verticalInset + (drawableHeight * (compact ? 0.5 : 0.58));
  const amplitude = Math.min(
    drawableHeight * (compact ? 0.42 : 0.24),
    Math.max(compact ? 16 : 4, previewBrush.size * (compact ? 0.74 : 0.28)),
  );
  const previewState = {
    startPoint: { x: startX, y: Math.floor(baseline) },
    lastPoint: { x: startX, y: Math.floor(baseline) },
    lastRenderedPoint: { x: startX, y: Math.floor(baseline) },
    lastAngle: 0,
    distance: 0,
    smoothedVelocity: 0,
    pickupColor: sampleCanvasColor(ctx, canvas, startX, Math.floor(baseline), compact ? 3 : 6),
  };

  const steps = compact ? 52 : 42;
  const startPoint = {
    x: startX,
    y: baseline - (amplitude * 0.78),
  };
  const endPoint = {
    x: startX + drawableWidth,
    y: baseline + (amplitude * 0.78),
  };
  const controlA = {
    x: startX + (drawableWidth * 0.24),
    y: baseline + (amplitude * 1.22),
  };
  const controlB = {
    x: startX + (drawableWidth * 0.7),
    y: baseline - (amplitude * 1.18),
  };
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const curvePoint = sampleCubicBezierPoint(startPoint, controlA, controlB, endPoint, t);
    const pressureWave = Math.sin(t * Math.PI);
    points.push({
      x: curvePoint.x,
      y: Math.min(safeHeight - verticalInset, Math.max(verticalInset, curvePoint.y)),
      pressure: Math.min(1.02, (compact ? 0.56 : 0.38) + pressureWave * (compact ? 0.2 : 0.5)),
    });
  }

  points.forEach((point, index) => {
    const previous = previewState.lastPoint;
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    previewState.distance += distance;
    previewState.smoothedVelocity = distance / (compact ? 10 : 12);
    stampBrushDab(ctx, {
      brush: previewBrush,
      point,
      pressure: point.pressure,
      tilt: {
        magnitude: clampPreviewTilt(previewBrush.previewTilt),
        angle: -0.45,
      },
      stroke: previewState,
      sampleCompositeColor: (sampleX, sampleY, radius = 2) => sampleCanvasColor(ctx, canvas, sampleX, sampleY, radius),
      initial: index === 0,
    });
    previewState.lastPoint = point;
  });

  return true;
}

function clampPreviewTilt(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
