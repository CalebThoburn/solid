// ---------------------------------------------------------------
// Face painting: pick a colour on the left, click a face to apply it.
// A named solid only has triangles, so the first paint converts it to a
// polygon shape (a cube gets 6 square faces) - painting whole faces.
// ---------------------------------------------------------------
const colorInput = document.getElementById("colorInput");
const hexInput = document.getElementById("hexInput");
const recentBox = document.getElementById("recentColors");
const paintToggle = document.getElementById("paintToggle");
const resetColorsBtn = document.getElementById("resetColorsBtn");

function isHexColor(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
}

// The last 8 colours actually used (painted, or given to a new face).
let recentColors = [];
try {
  const saved = JSON.parse(localStorage.getItem("recentColors") || "[]");
  if (Array.isArray(saved)) recentColors = saved.filter(isHexColor).slice(0, 8);
} catch (err) {
  /* storage unavailable - recents just won't persist */
}

function renderRecents() {
  recentBox.innerHTML = "";
  recentColors.forEach((hex) => {
    const b = document.createElement("button");
    b.style.background = hex;
    b.title = hex;
    b.classList.toggle("selected", hex === paintColor);
    b.addEventListener("click", () => {
      setPaintColor(hex);
      rememberColor(hex);
    });
    recentBox.appendChild(b);
  });
}

function rememberColor(hex) {
  hex = hex.toLowerCase();
  recentColors = [hex, ...recentColors.filter((c) => c !== hex)].slice(0, 8);
  try {
    localStorage.setItem("recentColors", JSON.stringify(recentColors));
  } catch (err) {
    /* ignore */
  }
  renderRecents();
}

function setPainting(on) {
  painting = on;
  paintToggle.classList.toggle("active", on);
  paintToggle.textContent = on ? "Painting: click a face" : "Paint faces";
  document.body.classList.toggle("painting", on);
}

function setPaintColor(hex) {
  paintColor = hex.toLowerCase();
  colorInput.value = paintColor;
  hexInput.value = paintColor;
  renderRecents();
  if (truncating)
    updateTruncationPreview(); // corner faces use the selected colour
  else if (mode !== "custom") setPainting(true); // picking a colour means you want to paint
}

colorInput.addEventListener("input", () => setPaintColor(colorInput.value));
colorInput.addEventListener("change", () => rememberColor(colorInput.value));
hexInput.addEventListener("change", () => {
  let v = hexInput.value.trim();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-f]{3}$/i.test(v))
    v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (isHexColor(v)) {
    setPaintColor(v);
    rememberColor(v);
  } else {
    hexInput.value = paintColor;
  }
});
paintToggle.addEventListener("click", () => setPainting(!painting));
document.querySelectorAll(".sectionHeader").forEach((header) => {
  const chevron = header.querySelector(".chevron");
  const body = document.getElementById(header.dataset.target);
  header.addEventListener("click", () => {
    const collapsed = body.classList.toggle("hidden");
    chevron.innerHTML = collapsed ? "&#9656;" : "&#9662;";
  });
});

resetColorsBtn.addEventListener("click", () => {
  if (!currentFacePolygons || !faceColors.some((c) => c)) return;
  perform({ type: "resetColors" });
});

function materializeNamedSolid() {
  const shape = currentPolygonShape();
  if (!shape || shape.faces.length === 0) return false;
  currentFacePolygons = normalizeFaceWinding(currentVerts, shape.faces);
  faceColors = currentFacePolygons.map(() => null);
  currentSolidName = null;
  currentSolidScale = 1;
  dualCentre = null;
  setActiveSolidButton(null);
  renderCurrentShape();
  return true;
}

function tryPaintFaceAt(clientX, clientY) {
  if (mode === "custom" || truncating || stellActive) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  scene.updateMatrixWorld(true);

  let mesh = faceMeshObjects.find((o) => o.isMesh);
  if (!mesh || raycaster.intersectObject(mesh).length === 0) return;

  if (!currentFacePolygons) {
    if (!materializeNamedSolid()) return;
    scene.updateMatrixWorld(true);
    mesh = faceMeshObjects.find((o) => o.isMesh);
    if (!mesh) return;
  }

  const hits = raycaster.intersectObject(mesh);
  if (hits.length === 0) return;
  const fi = mesh.geometry.userData.triFace[hits[0].faceIndex];
  if (fi === undefined || faceColors[fi] === paintColor) return;
  rememberColor(paintColor);
  perform({ type: "paint", face: fi, color: paintColor });
}

setPaintColor(paintColor);
setPainting(false);
