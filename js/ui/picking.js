// ---------------------------------------------------------------
// Picking a vertex (used only in custom face-building mode)
// ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function trySelectPointAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);

  const selectable = vertexSpheres.filter((s) => s.visible);
  const hits = raycaster.intersectObjects(selectable);
  if (hits.length === 0) return;

  const sphere = hits[0].object;
  const idx = sphere.userData.index;
  if (!selectedIndices.includes(idx)) {
    selectedIndices.push(idx);
    sphere.material.color.setHex(highlightColorHex);
    updateSelectablePoints();
    if (colorRelative) {
      recolorPoints();
      infoDiv.textContent = colouringDescription();
    }
  }
}

function tryCreateFaceFromSelection() {
  if (selectedIndices.length >= 3) {
    pendingFacePolygons.push(selectedIndices.slice());
    pendingFaceColors.push(paintColor);
    lastUserFace = selectedIndices.slice();
    lastUserFaceColor = paintColor;
    rememberColor(paintColor);
    setFaceGeometry(
      geometryFromFacePolygons(
        currentVerts,
        pendingFacePolygons,
        pendingFaceColors,
      ),
    );
  }
  clearAllSelectionHighlights();
  updateSelectablePoints();
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && mode === "custom") {
    e.preventDefault();
    tryCreateFaceFromSelection();
  }
});

// Tab: switch between colouring by overall symmetry and colouring as
// seen from the selected point (the most recently selected one).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || mode !== "custom") return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  if (selectedIndices.length === 0) {
    infoDiv.textContent =
      "Select a point first, then press Tab to colour the others as seen from it";
    return;
  }
  if (selectedIndices.length === 1 && !symmetryPerms) {
    infoDiv.textContent = "Couldn't work out this shape's symmetry";
    return;
  }
  colorRelative = !colorRelative;
  recolorPoints();
  infoDiv.textContent = colouringDescription();
});
