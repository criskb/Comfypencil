function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const WHEEL_SIZE = 220;
const RING_OUTER_RADIUS = 108;
const RING_INNER_RADIUS = 72;
const RING_MARKER_RADIUS = 90;
const SQUARE_SIZE = 118;
const SQUARE_OFFSET = 51;

function wrapHue(hue) {
  let value = hue % 360;
  if (value < 0) {
    value += 360;
  }
  return value;
}

function hsvToRgb(h, s, v) {
  const hue = wrapHue(h);
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const normalized = (hex || "#000000").replace("#", "").padStart(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === red) {
      h = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      h = 60 * (((blue - red) / delta) + 2);
    } else {
      h = 60 * (((red - green) / delta) + 4);
    }
  }
  if (h < 0) {
    h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

export function hsvToHex(h, s, v) {
  return rgbToHex(hsvToRgb(h, s, v));
}

export class ColorWheelControl {
  constructor({ onChange, onPreview, onCommit } = {}) {
    this.onPreview = onPreview;
    this.onCommit = onCommit || onChange;
    this.hsv = { h: 220, s: 0.5, v: 0.5 };
    this.root = document.createElement("div");
    this.root.className = "cp-wheel";

    this.wheelCanvas = document.createElement("canvas");
    this.wheelCanvas.className = "cp-wheel__ring";
    this.squareCanvas = document.createElement("canvas");
    this.squareCanvas.className = "cp-wheel__square";
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "cp-wheel__markers";
    this.ringMarker = document.createElement("div");
    this.ringMarker.className = "cp-wheel__marker cp-wheel__marker--ring";
    this.squareMarker = document.createElement("div");
    this.squareMarker.className = "cp-wheel__marker cp-wheel__marker--square";
    this.markerLayer.append(this.ringMarker, this.squareMarker);
    this.root.append(this.wheelCanvas, this.squareCanvas, this.markerLayer);

    this.#bind();
    this.#draw();
  }

  mount(container) {
    container.appendChild(this.root);
  }

  setHex(hex, { silent = false } = {}) {
    this.hsv = hexToHsv(hex);
    this.#draw();
    if (!silent) {
      this.onCommit?.(this.getHex());
    }
  }

  getHex() {
    return hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
  }

  #bind() {
    this.#bindRing();
    this.#bindSquare();
  }

  #bindRing() {
    const update = (event) => {
      const rect = this.wheelCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      const angle = Math.atan2(y, x) * (180 / Math.PI);
      this.hsv.h = wrapHue(angle + 90);
      this.#draw();
      this.onPreview?.(this.getHex());
    };
    this.wheelCanvas.addEventListener("pointerdown", (event) => {
      update(event);
      const move = (moveEvent) => update(moveEvent);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.onCommit?.(this.getHex());
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
  }

  #bindSquare() {
    const update = (event) => {
      const rect = this.squareCanvas.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      this.hsv.s = x;
      this.hsv.v = 1 - y;
      this.#draw();
      this.onPreview?.(this.getHex());
    };
    this.squareCanvas.addEventListener("pointerdown", (event) => {
      update(event);
      const move = (moveEvent) => update(moveEvent);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.onCommit?.(this.getHex());
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
  }

  #draw() {
    this.#drawRing();
    this.#drawSquare();
    this.#syncMarkers();
  }

  #drawRing() {
    const size = WHEEL_SIZE;
    const dpr = window.devicePixelRatio || 1;
    this.wheelCanvas.width = size * dpr;
    this.wheelCanvas.height = size * dpr;
    this.wheelCanvas.style.width = `${size}px`;
    this.wheelCanvas.style.height = `${size}px`;

    const ctx = this.wheelCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const gradient = ctx.createConicGradient(-Math.PI / 2, size / 2, size / 2);
    for (let hue = 0; hue <= 360; hue += 30) {
      gradient.addColorStop(hue / 360, hsvToHex(hue, 1, 1));
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, RING_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.arc(size / 2, size / 2, RING_INNER_RADIUS, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  }

  #drawSquare() {
    const size = SQUARE_SIZE;
    const dpr = window.devicePixelRatio || 1;
    this.squareCanvas.width = size * dpr;
    this.squareCanvas.height = size * dpr;
    this.squareCanvas.style.width = `${size}px`;
    this.squareCanvas.style.height = `${size}px`;

    const ctx = this.squareCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = hsvToHex(this.hsv.h, 1, 1);
    ctx.fillRect(0, 0, size, size);

    const whiteGradient = ctx.createLinearGradient(0, 0, size, 0);
    whiteGradient.addColorStop(0, "rgba(255,255,255,1)");
    whiteGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = whiteGradient;
    ctx.fillRect(0, 0, size, size);

    const blackGradient = ctx.createLinearGradient(0, 0, 0, size);
    blackGradient.addColorStop(0, "rgba(0,0,0,0)");
    blackGradient.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = blackGradient;
    ctx.fillRect(0, 0, size, size);

  }

  #syncMarkers() {
    const angle = (this.hsv.h - 90) * (Math.PI / 180);
    const ringCenter = WHEEL_SIZE / 2;
    const ringX = ringCenter + Math.cos(angle) * RING_MARKER_RADIUS;
    const ringY = ringCenter + Math.sin(angle) * RING_MARKER_RADIUS;
    this.ringMarker.style.left = `${ringX}px`;
    this.ringMarker.style.top = `${ringY}px`;

    const squareX = SQUARE_OFFSET + (this.hsv.s * SQUARE_SIZE);
    const squareY = SQUARE_OFFSET + ((1 - this.hsv.v) * SQUARE_SIZE);
    this.squareMarker.style.left = `${squareX}px`;
    this.squareMarker.style.top = `${squareY}px`;
  }
}
