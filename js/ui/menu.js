// ---------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------
const loadSolidToggle = document.getElementById("loadSolidToggle");
const solidSubmenu = document.getElementById("solidSubmenu");
const solidButtons = document.querySelectorAll(
  "#solidSubmenu button[data-solid]",
);
const dualBtn = document.getElementById("dualBtn");
const reorderBtn = document.getElementById("reorderBtn");
const uniformBtn = document.getElementById("uniformBtn");
const allReorderBtn = document.getElementById("allReorderBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const infoDiv = document.getElementById("info");

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

document.addEventListener("keydown", (e) => {
  if (mode === "custom") return; // Space is used for face-building there
  if (multiverseOpen) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (
    (e.ctrlKey || e.metaKey) &&
    (key === "y" || (key === "z" && e.shiftKey))
  ) {
    e.preventDefault();
    redo();
  }
});

loadSolidToggle.addEventListener("click", () => {
  solidSubmenu.classList.toggle("hidden");
});

function setActiveSolidButton(name) {
  solidButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.solid === name);
  });
}

solidButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    perform({ type: "solid", name: btn.dataset.solid });
    solidSubmenu.classList.add("hidden");
  });
});

dualBtn.addEventListener("click", () => {
  if (!currentVerts.length) return;
  if (!perform({ type: "dual" })) {
    infoDiv.textContent = "Can't compute a dual from this shape";
  }
});

reorderBtn.addEventListener("click", () => {
  if (!currentVerts.length) return;

  if (mode !== "custom") {
    // Enter reorder mode: strip faces, show all points
    closeTruncationPanel(false);
    closeStellationPanel(false);
    setPainting(false);
    mode = "custom";
    pendingFacePolygons = [];
    pendingFaceColors = [];
    lastUserFace = null;
    reorderBacklog = null;
    clearAllSelectionHighlights();
    setFaceGeometry(null);
    updateSelectablePoints();
    reorderBtn.classList.add("active");
    uniformBtn.classList.remove("hidden");
    allReorderBtn.classList.remove("hidden");
    reorderBtn.textContent = "Exit Reorder Mode";
    const kinds = colourPointsBySymmetry();
    infoDiv.textContent =
      "Click coplanar points, then press Space to add a face \u00b7 " +
      (kinds <= 0
        ? "points are uncoloured (couldn't work out their symmetry)"
        : kinds === 1
          ? "all points are alike"
          : kinds +
            " kinds of point (same colour = symmetrically alike) \u00b7 select a point, then Tab to see from it");
  } else {
    // Exit reorder mode: persist whatever faces were built as the new shape
    clearAllSelectionHighlights();
    const built =
      pendingFacePolygons.length > 0 &&
      perform({
        type: "reorder",
        faces: pendingFacePolygons.map((f) => f.slice()),
        colors: pendingFacePolygons.map((_, i) => pendingFaceColors[i] || null),
        vertexCount: currentVerts.length,
      });
    if (!built) showShape(currentShape());
  }
});

// Colours every point by its kind (see computeVertexOrbits), so which
// points are interchangeable is visible at a glance. A shape with only
// one kind keeps the plain point colour.
function colourPointsBySymmetry() {
  let kinds = 0;
  colorRelative = false;
  try {
    symmetryPerms = findPointSetSymmetries(currentVerts);
    const { kindOf, count } = orbitsFromPerms(
      currentVerts.length,
      symmetryPerms,
    );
    kinds = count;
    globalColorHex = kindOf.map((k) =>
      count === 1 ? pointColorHex : kindColorHex(k),
    );
  } catch (err) {
    symmetryPerms = null;
    globalColorHex = [];
    kinds = 0;
  }
  recolorPoints();
  return kinds;
}

// Paints every point for the current colouring mode (Tab switches
// between the two). Overall: points that are symmetrically alike share
// a colour. Second mode, with ONE point selected: that point is treated
// as the origin, so only the symmetries that leave IT in place count -
// two points share a colour when one of those carries the other to it
// (on an icosahedron: the point, its 5 neighbours, the 5 next out, and
// the opposite point, as four colours). Second mode, with TWO or more
// selected: points share a colour when they lie in the same plane with
// the two latest selected points. Selected points always stay amber.
function recolorPoints() {
  const sel = selectedIndices;
  if (colorRelative && sel.length >= 2) {
    const ib = sel[sel.length - 1],
      ia = sel[sel.length - 2];
    const { kindOf } = planeKindsThroughTwo(currentVerts, ia, ib);
    vertexColorHex = kindOf.map((k) => (k < 0 ? 0xcfd6e4 : kindColorHex(k)));
  } else if (colorRelative && sel.length === 1 && symmetryPerms) {
    const origin = sel[0];
    const stabiliser = symmetryPerms.filter((perm) => perm[origin] === origin);
    const { kindOf } = orbitsFromPerms(currentVerts.length, stabiliser);
    vertexColorHex = kindOf.map((k) => kindColorHex(k));
  } else {
    vertexColorHex = globalColorHex.slice();
  }
  vertexSpheres.forEach((sphere, i) => {
    if (sel.includes(i)) sphere.material.color.setHex(highlightColorHex);
    else resetSphereColor(i);
  });
}

function colouringDescription() {
  if (!colorRelative) {
    return "Coloured by overall symmetry (same colour = symmetrically alike) \u00b7 Tab to switch";
  }
  if (selectedIndices.length >= 2) {
    return "Coloured by plane with the two latest points (same colour = coplanar with them, grey = on the line between them) \u00b7 Tab to switch back";
  }
  return "Coloured as seen from the selected point (same colour = alike from there) \u00b7 Tab to switch back";
}

// "Create face uniformly": copy the last hand-made face to every place
// the shape's own symmetry puts it. The copies use exactly the points
// that are symmetrically similar to the face's points (same distance
// from the centre, same arrangement of points around them) - so on a
// shape where only some points are alike, only those get a copy.
uniformBtn.addEventListener("click", () => {
  if (mode !== "custom") return;
  if (!lastUserFace) {
    infoDiv.textContent =
      "Make a face first (select points, press Space), then copy it uniformly";
    return;
  }
  const symmetries = findPointSetSymmetries(currentVerts);
  const seen = new Set(pendingFacePolygons.map(faceCycleKey));
  let added = 0;
  symmetries.forEach((perm) => {
    const copy = lastUserFace.map((i) => perm[i]);
    if (new Set(copy).size < copy.length) return;
    const key = faceCycleKey(copy);
    if (seen.has(key)) return;
    seen.add(key);
    pendingFacePolygons.push(copy);
    pendingFaceColors.push(lastUserFaceColor);
    added++;
  });
  if (added) {
    setFaceGeometry(
      geometryFromFacePolygons(
        currentVerts,
        pendingFacePolygons,
        pendingFaceColors,
      ),
    );
    infoDiv.textContent =
      "Added " + added + " matching face" + (added === 1 ? "" : "s");
  } else if (symmetries.length <= 1) {
    infoDiv.textContent =
      "These points have no symmetry to copy the face across";
  } else {
    infoDiv.textContent = "Every symmetric copy of that face already exists";
  }
});
