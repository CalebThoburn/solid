// ---------------------------------------------------------------
// Shapes as plain records. A shape is
//   { verts, facePolygons, solidName, solidScale, faceColors, dualCentre }
// - the same fields as the scene state above. Every operation turns one
// shape into a new one without touching the scene (see actions.js), so
// the same operation can be replayed on another universe's shape.
// ---------------------------------------------------------------
function emptyShape() {
  return {
    verts: [],
    facePolygons: null,
    solidName: null,
    solidScale: 1,
    faceColors: [],
    dualCentre: null,
  };
}

function cloneShape(shape) {
  return {
    verts: shape.verts.map((v) => v.clone()),
    facePolygons: shape.facePolygons
      ? shape.facePolygons.map((f) => f.slice())
      : null,
    solidName: shape.solidName,
    solidScale: shape.solidScale,
    faceColors: shape.faceColors
      ? shape.faceColors.slice()
      : shape.facePolygons
        ? shape.facePolygons.map(() => null)
        : [],
    dualCentre: shape.dualCentre ? shape.dualCentre.clone() : null,
  };
}

// A named solid, scaled to match the size of the shape before it.
function solidShape(prev, name) {
  const rawVerts = uniqueVerticesFromGeometry(SOLID_GEOMETRIES[name]());
  const rawSize = shapeSize(rawVerts);
  const prevSize = prev.verts.length > 0 ? shapeSize(prev.verts) : null;
  const scale = prevSize !== null && rawSize > 1e-6 ? prevSize / rawSize : 1;
  return {
    verts: rawVerts.map((v) => v.clone().multiplyScalar(scale)),
    facePolygons: null,
    solidName: name,
    solidScale: scale,
    faceColors: [],
    dualCentre: null,
  };
}

// A freshly computed polyhedron, moved so its bounding box is centred
// on the origin (the centre of rotation) and scaled so its farthest
// vertex is as far out as the previous shape's was, so nothing needs
// re-zooming or re-centring. `centre` is the point a dual was
// reciprocated about; it moves and scales along with the shape so the
// next dual can reuse it.
function customShape(prev, newVerts, newFacePolygons, centre, colors) {
  const prevSize = prev.verts.length > 0 ? shapeSize(prev.verts) : null;
  const newSize = shapeSize(newVerts);
  const scale = prevSize !== null && newSize > 1e-6 ? prevSize / newSize : 1;
  const shift = boundsCentre(newVerts);
  return {
    verts: newVerts.map((v) => v.clone().sub(shift).multiplyScalar(scale)),
    facePolygons: newFacePolygons.map((f) => f.slice()),
    solidName: null,
    solidScale: 1,
    faceColors: colors ? colors.slice() : newFacePolygons.map(() => null),
    dualCentre: centre ? centre.clone().sub(shift).multiplyScalar(scale) : null,
  };
}

// Vertices + polygon faces of a shape (a named solid's triangles are
// merged back into its real faces).
function polygonShapeOf(shape) {
  if (shape.facePolygons)
    return { verts: shape.verts, faces: shape.facePolygons };
  if (!shape.solidName) return null;
  const geometry = SOLID_GEOMETRIES[shape.solidName]();
  geometry.scale(shape.solidScale, shape.solidScale, shape.solidScale);
  const tris = facesFromRawGeometry(geometry, shape.verts);
  return {
    verts: shape.verts,
    faces: mergeCoplanarTriangles(shape.verts, tris),
  };
}

// A named solid only has triangles; this turns it into a polygon shape
// (a cube gets 6 square faces) so whole faces can be painted.
function materializedShape(shape) {
  if (shape.facePolygons) return cloneShape(shape);
  const poly = polygonShapeOf(shape);
  if (!poly || poly.faces.length === 0) return null;
  const faces = normalizeFaceWinding(shape.verts, poly.faces);
  return {
    verts: shape.verts.map((v) => v.clone()),
    facePolygons: faces,
    solidName: null,
    solidScale: 1,
    faceColors: faces.map(() => null),
    dualCentre: null,
  };
}

// Render geometry for a shape (null if it has no faces).
function geometryForShape(shape) {
  if (shape.facePolygons) {
    return geometryFromFacePolygons(
      shape.verts,
      shape.facePolygons,
      shape.faceColors,
    );
  }
  if (shape.solidName) {
    const geometry = SOLID_GEOMETRIES[shape.solidName]();
    geometry.scale(shape.solidScale, shape.solidScale, shape.solidScale);
    return geometry;
  }
  return null;
}

// ---------------------------------------------------------------
// Showing a shape: makes it the scene state and resets the view to
// plain viewing mode (used for every finished change, undo/redo and
// switching universes).
// ---------------------------------------------------------------
function showShape(shape) {
  closeTruncationPanel(false);
  closeStellationPanel(false);
  const s = cloneShape(shape);
  currentVerts = s.verts;
  currentFacePolygons = s.facePolygons;
  currentSolidName = s.solidName;
  currentSolidScale = s.solidScale;
  faceColors = s.faceColors;
  dualCentre = s.dualCentre;
  rebuildVertexSpheres(currentVerts);
  hideAllVertexSpheres();

  mode = "original";
  pendingFacePolygons = [];
  selectedIndices = [];
  renderCurrentShape();

  setActiveSolidButton(currentSolidName);
  dualBtn.disabled = false;
  reorderBtn.disabled = false;
  exportBtn.disabled = false;
  reorderBtn.classList.remove("active");
  uniformBtn.classList.add("hidden");
  allReorderBtn.classList.add("hidden");
  reorderBtn.textContent = "Reorder Convex Hull";
  infoDiv.textContent = "Drag to rotate · Scroll to zoom";
  updateUndoRedoButtons();
}
