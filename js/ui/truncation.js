// ---------------------------------------------------------------
// Truncation slider: live preview while dragging, Apply makes it the
// new polyhedron (so dual, reorder, undo etc. all work on the result).
//
// The slider runs through every depth of cut (t, see truncatePolyhedron):
// antitruncation off the left end, then none, uniform truncation exactly
// halfway to rectification, hypertruncation, and quasitruncation (with
// its uniform point) off the right. Its position maps onto t piecewise,
// so those landmarks sit at fixed places whatever the shape, and it
// snaps to them.
// ---------------------------------------------------------------
const truncBtn = document.getElementById("truncBtn");
const truncPanel = document.getElementById("truncPanel");
const truncSlider = document.getElementById("truncSlider");
const truncTicks = document.getElementById("truncTicks");
const truncLabel = document.getElementById("truncLabel");
const truncApply = document.getElementById("truncApply");
const truncCancel = document.getElementById("truncCancel");
let truncating = false;
let truncSource = null;
let truncColors = null;
let truncKnots = []; // [{ pos, t, preset? }] slider positions and the depths there

const TRUNC_SNAP = 4; // slider steps within which a landmark catches
const TRUNC_DEGENERATE = 150; // t = 1: the cuts reach the far corners

// Original faces keep their colour; the new corner faces get `newColor`.
function carryColors(origin, colors, newColor) {
  return origin.map((o) => (o >= 0 ? (colors && colors[o]) || null : newColor));
}

// What a depth of cut is called. `verb` gives the short form shown on a
// universe's plaque ("Rectify"), otherwise the name ("Rectification").
function truncationName(t, preset, verb) {
  if (preset === "uniform") return verb ? "Truncate (uniform)" : "Uniform truncation";
  if (preset === "quasiUniform")
    return verb ? "Quasitruncate (uniform)" : "Uniform quasitruncation";
  if (Math.abs(t - 0.5) < 1e-9) return verb ? "Rectify" : "Rectification";
  if (t < 0) return verb ? "Antitruncate" : "Antitruncation";
  if (t < 0.5)
    return verb ? "Truncate " + Math.round(t * 200) + "%" : "Truncation";
  if (t < 1) return verb ? "Hypertruncate" : "Hypertruncation";
  return verb ? "Quasitruncate" : "Quasitruncation";
}

// The slider's landmarks for the shape being truncated.
function truncationKnots(depths) {
  const quasi = depths.quasi !== null && depths.quasi > 1.01 ? depths.quasi : null;
  const far = quasi || 2;
  return [
    { pos: -100, t: -0.5 },
    { pos: 0, t: 0, snap: true },
    { pos: 50, t: depths.truncate, preset: "uniform", snap: true },
    { pos: 100, t: 0.5, snap: true },
    { pos: TRUNC_DEGENERATE, t: 1 },
    quasi
      ? { pos: 200, t: quasi, preset: "quasiUniform", snap: true }
      : { pos: 200, t: far },
    { pos: 250, t: far + (far - 1) },
  ];
}

function truncationAt(pos) {
  for (let i = 0; i + 1 < truncKnots.length; i++) {
    const a = truncKnots[i],
      b = truncKnots[i + 1];
    if (pos <= b.pos) {
      if (pos === a.pos) return { t: a.t, preset: a.preset };
      if (pos === b.pos) return { t: b.t, preset: b.preset };
      return { t: a.t + ((pos - a.pos) / (b.pos - a.pos)) * (b.t - a.t) };
    }
  }
  const last = truncKnots[truncKnots.length - 1];
  return { t: last.t };
}

function renderTruncationTicks() {
  truncTicks.innerHTML = "";
  const min = Number(truncSlider.min),
    max = Number(truncSlider.max);
  truncKnots.forEach((k) => {
    if (k.pos === min || k.pos === max) return;
    const tick = document.createElement("span");
    tick.style.left = ((k.pos - min) / (max - min)) * 100 + "%";
    if (k.preset) tick.className = "uniform";
    truncTicks.appendChild(tick);
  });
}

function closeTruncationPanel(restoreView) {
  if (!truncating) return;
  truncating = false;
  previewChildren(null);
  truncPanel.classList.add("hidden");
  truncBtn.classList.remove("active");
  if (restoreView) renderCurrentShape();
}

function updateTruncationPreview() {
  let pos = Number(truncSlider.value);
  const snap = truncKnots.find(
    (k) => k.snap && k.pos !== pos && Math.abs(k.pos - pos) <= TRUNC_SNAP,
  );
  if (snap) {
    pos = snap.pos;
    truncSlider.value = pos;
  }
  const { t, preset } = truncationAt(pos);
  truncApply.disabled = pos === 0 || pos === TRUNC_DEGENERATE;

  if (pos === 0) {
    truncLabel.textContent = "No truncation";
    renderCurrentShape();
    previewChildren(null);
    return;
  }
  if (pos === TRUNC_DEGENERATE) {
    truncLabel.textContent =
      "Cut reaches the far corners (t = 1): every edge collapses";
  } else {
    truncLabel.textContent =
      truncationName(t, preset, false) + " · depth " + t.toFixed(3);
  }
  const result = truncatePolyhedron(truncSource.verts, truncSource.faces, t);
  if (result.error) {
    infoDiv.textContent = "Can't truncate: " + result.error;
    return;
  }
  const preview = fitToCurrentSize(result.vertices);
  setFaceGeometry(
    geometryFromFacePolygons(
      preview,
      result.faces,
      carryColors(result.origin, truncColors, paintColor),
    ),
  );
  // the children, replayed onto this truncation as you drag
  if (activeUniverse.children.length) {
    const action = { type: "truncate", t, color: paintColor };
    if (preset) action.preset = preset;
    previewChildren(tryAction(currentShape(), action));
  }
}

truncBtn.addEventListener("click", () => {
  if (truncating) {
    closeTruncationPanel(true);
    return;
  }
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before truncating";
    return;
  }
  closeStellationPanel(true);
  const shape = currentPolygonShape();
  if (!shape || shape.faces.length === 0) return;
  const probe = truncatePolyhedron(shape.verts, shape.faces, 0.25);
  if (probe.error) {
    infoDiv.textContent = "Can't truncate: " + probe.error;
    return;
  }
  truncKnots = truncationKnots(uniformTruncationDepths(shape.verts, shape.faces));
  renderTruncationTicks();
  truncSource = shape;
  truncColors = currentFacePolygons ? faceColors.slice() : null;
  truncating = true;
  truncSlider.value = 0;
  truncPanel.classList.remove("hidden");
  truncBtn.classList.add("active");
  updateTruncationPreview();
});

truncSlider.addEventListener("input", updateTruncationPreview);
truncCancel.addEventListener("click", () => closeTruncationPanel(true));

truncApply.addEventListener("click", () => {
  if (!truncating) return;
  const pos = Number(truncSlider.value);
  if (pos === 0 || pos === TRUNC_DEGENERATE) return;
  const { t, preset } = truncationAt(pos);
  const result = truncatePolyhedron(truncSource.verts, truncSource.faces, t);
  if (result.error) {
    infoDiv.textContent = "Can't truncate: " + result.error;
    return;
  }
  rememberColor(paintColor);
  const action = { type: "truncate", t, color: paintColor };
  if (preset) action.preset = preset;
  perform(action);
});
