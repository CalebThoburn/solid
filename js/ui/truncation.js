// ---------------------------------------------------------------
// Truncation slider: live preview while dragging, Apply makes it the
// new polyhedron (so dual, reorder, undo etc. all work on the result).
// ---------------------------------------------------------------
const truncBtn = document.getElementById("truncBtn");
const truncPanel = document.getElementById("truncPanel");
const truncSlider = document.getElementById("truncSlider");
const truncLabel = document.getElementById("truncLabel");
const truncApply = document.getElementById("truncApply");
const truncCancel = document.getElementById("truncCancel");
let truncating = false;
let truncSource = null;
let truncColors = null;

// Original faces keep their colour; the new corner faces get `newColor`.
function carryColors(origin, colors, newColor) {
  return origin.map((o) => (o >= 0 ? (colors && colors[o]) || null : newColor));
}

function closeTruncationPanel(restoreView) {
  if (!truncating) return;
  truncating = false;
  truncPanel.classList.add("hidden");
  truncBtn.classList.remove("active");
  if (restoreView) renderCurrentShape();
}

function updateTruncationPreview() {
  const pct = Number(truncSlider.value);
  truncLabel.textContent =
    pct === 0
      ? "Truncation: none"
      : pct === 100
        ? "Rectification"
        : "Truncation: " + pct + "%";
  if (pct === 0) {
    renderCurrentShape();
    return;
  }
  const result = truncatePolyhedron(
    truncSource.verts,
    truncSource.faces,
    (pct / 100) * 0.5,
  );
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
  const pct = Number(truncSlider.value);
  if (pct === 0) {
    closeTruncationPanel(true);
    return;
  }
  const result = truncatePolyhedron(
    truncSource.verts,
    truncSource.faces,
    (pct / 100) * 0.5,
  );
  if (result.error) {
    infoDiv.textContent = "Can't truncate: " + result.error;
    return;
  }
  rememberColor(paintColor);
  perform({ type: "truncate", t: (pct / 100) * 0.5, color: paintColor });
});
