export function button(label, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

export function layerBadge(label, className = "") {
  const element = document.createElement("span");
  element.className = ["cp-layer__badge", className].filter(Boolean).join(" ");
  element.textContent = label;
  return element;
}

export function createField(labelText, inputElement) {
  const wrapper = document.createElement("div");
  wrapper.className = "cp-control";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrapper.append(label, inputElement);
  return wrapper;
}

export function slider(min, max, step, value) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

export function textInput(value = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  return input;
}

export function select(options, value) {
  const element = document.createElement("select");
  options.forEach((item) => {
    const option = document.createElement("option");
    if (typeof item === "string") {
      option.value = item;
      option.textContent = item;
    } else {
      option.value = item.value;
      option.textContent = item.label;
    }
    element.appendChild(option);
  });
  element.value = value;
  return element;
}
