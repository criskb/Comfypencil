export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mixColor(colorA, colorB, amountOfB) {
  const t = clamp(amountOfB, 0, 1);
  return {
    r: Math.round(lerp(colorA.r, colorB.r, t)),
    g: Math.round(lerp(colorA.g, colorB.g, t)),
    b: Math.round(lerp(colorA.b, colorB.b, t)),
    a: Math.round(lerp(colorA.a ?? 255, colorB.a ?? 255, t)),
  };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeHexColor(hex, fallback = "#000000") {
  if (typeof hex !== "string") {
    return fallback;
  }
  const normalized = hex.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

export function rgbToHsv({ r, g, b, a = 255 }) {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const delta = maxChannel - minChannel;

  let hue = 0;
  if (delta > 0.00001) {
    if (maxChannel === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (maxChannel === green) {
      hue = ((blue - red) / delta) + 2;
    } else {
      hue = ((red - green) / delta) + 4;
    }
    hue /= 6;
    if (hue < 0) {
      hue += 1;
    }
  }

  return {
    h: hue,
    s: maxChannel === 0 ? 0 : delta / maxChannel,
    v: maxChannel,
    a,
  };
}

export function hsvToRgb({ h = 0, s = 0, v = 0, a = 255 }) {
  const hue = ((Number(h) % 1) + 1) % 1;
  const saturation = clamp(Number(s) || 0, 0, 1);
  const value = clamp(Number(v) || 0, 0, 1);
  const scaledHue = hue * 6;
  const index = Math.floor(scaledHue);
  const fraction = scaledHue - index;
  const p = value * (1 - saturation);
  const q = value * (1 - (fraction * saturation));
  const t = value * (1 - ((1 - fraction) * saturation));

  const channelMap = [
    [value, t, p],
    [q, value, p],
    [p, value, t],
    [p, q, value],
    [t, p, value],
    [value, p, q],
  ][index % 6];

  return {
    r: Math.round(channelMap[0] * 255),
    g: Math.round(channelMap[1] * 255),
    b: Math.round(channelMap[2] * 255),
    a: clamp(a, 0, 255),
  };
}

export function noise2d(x, y, seed = 0) {
  const value = Math.sin((x * 12.9898) + (y * 78.233) + (seed * 37.719)) * 43758.5453;
  return value - Math.floor(value);
}

export function darkenColor(color, amount) {
  return mixColor(color, { r: 0, g: 0, b: 0, a: color.a ?? 255 }, clamp(amount, 0, 1));
}

export function lightenColor(color, amount) {
  return mixColor(color, { r: 255, g: 255, b: 255, a: color.a ?? 255 }, clamp(amount, 0, 1));
}

export function rgbaFromHex(hex, alpha = 1) {
  const normalized = (hex || "#000000").replace("#", "").padStart(6, "0").slice(0, 6);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hexToColor(hex, alpha = 255) {
  const normalized = (hex || "#000000").replace("#", "").padStart(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: clamp(alpha, 0, 255),
  };
}

export function angleFromPoints(fromPoint, toPoint, fallback = 0) {
  if (!fromPoint || !toPoint) {
    return fallback;
  }
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return fallback;
  }
  return Math.atan2(dy, dx);
}

export function pressureScale(pressure, amount) {
  const normalizedPressure = clamp(pressure || 1, 0.08, 1.4);
  return lerp(1, normalizedPressure, clamp(amount ?? 0, 0, 1));
}
