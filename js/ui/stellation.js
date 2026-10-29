// ---------------------------------------------------------------
// Stellation UI: one 2D stellation diagram per type of face. Clicking
// a cell switches it - and every cell the shape's rotations carry it
// to - in or out, and the 3D view previews the result. "Stellate
// completely" instead grows every face by one shell: the next
// stellation along the main line.
// ---------------------------------------------------------------
const stellMapBtn = document.getElementById("stellMapBtn");
const stellPanel = document.getElementById("stellPanel");
const stellDiagrams = document.getElementById("stellDiagrams");
const stellStatus = document.getElementById("stellStatus");
const stellFullBtn = document.getElementById("stellFullBtn");
const stellApply = document.getElementById("stellApply");
const stellReset = document.getElementById("stellReset");
const stellCancel = document.getElementById("stellCancel");

const SVG_NS = "http://www.w3.org/2000/svg";

let stellActive = false;
let stellRegions = null;
let stellOrbits = []; // orbit id -> the cells switched together
let stellFaceTypes = []; // [{ rep, faces }]
let stellCellEls = []; // [{ region, el }] for every drawn diagram cell
let stellHoverOrbit = -1;
let stellObjects = [];
let stellOriginalColors = null; // faceColors as they were before this session
let stellResult = null; // the shape the current selection builds

function clearStellObjects() {
  stellObjects.forEach((o) => {
    shapeGroup.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  stellObjects = [];
  stellGlowMaterials = [];
}

function stellCellEdgePoints(region) {
  const pts = region.poly2D.map((p2) => stellTo3D(p2, region.plane));
  const segs = [];
  for (let i = 0; i < pts.length; i++)
    segs.push(pts[i], pts[(i + 1) % pts.length]);
  return segs;
}
function stellLineGeometry(points) {
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}
function stellAddLines(points, material) {
  if (!points.length) return;
  const lines = new THREE.LineSegments(stellLineGeometry(points), material);
  shapeGroup.add(lines);
  stellObjects.push(lines);
}

function stellSelectionChanged() {
  return stellRegions.some((r) => !!r.on !== r.isOriginal);
}

// Rebuilds the previewed shape after the selection changes.
function updateStellResult() {
  stellResult = stellCellSelectionResult(
    stellRegions,
    stellOriginalColors,
    paintColor,
  );
}

// The colour each switched-on cell shows: its face's own colour while
// that face is made only of the shape's own cells, the selected colour
// once it has gained cells (matching what Apply will build).
function stellCellColors() {
  const colors = new Map();
  stellSelectionGroups(stellRegions).forEach((group) => {
    const face = group[0].face;
    const c = group.every((r) => r.isOriginal)
      ? (stellOriginalColors && stellOriginalColors[face]) ||
        "#" + faceColorHex.toString(16).padStart(6, "0")
      : paintColor;
    group.forEach((r) => colors.set(r, c));
  });
  return colors;
}

// 3D view: the shape the current selection builds, the map's bounded
// cells as faint lines, and the hovered cell's orbit glowing.
function renderStellationView() {
  clearStellObjects();
  if (!stellRegions) return;

  const result = stellResult;
  setFaceGeometry(
    result
      ? geometryFromFacePolygons(result.vertices, result.faces, result.colors)
      : null,
  );

  // only the cells in use and the ones next to them, so the shape
  // isn't lost in the full map's lines
  const near = new Set();
  stellRegions.forEach((r) => {
    if (!r.on) return;
    near.add(r);
    r.neighbors.forEach((n) => near.add(n));
  });
  const dimPts = [];
  near.forEach((r) => {
    if (!r.unbounded) dimPts.push(...stellCellEdgePoints(r));
  });
  stellAddLines(
    dimPts,
    new THREE.LineBasicMaterial({
      color: 0x3a4356,
      transparent: true,
      opacity: 0.5,
    }),
  );

  if (stellHoverOrbit >= 0) {
    const pts = [];
    stellOrbits[stellHoverOrbit].forEach((r) =>
      pts.push(...stellCellEdgePoints(r)),
    );
    const haloMat = new THREE.LineBasicMaterial({
      color: highlightColorHex,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sharpMat = new THREE.LineBasicMaterial({
      color: highlightColorHex,
      transparent: true,
      opacity: 1,
    });
    stellAddLines(pts, haloMat);
    stellAddLines(pts, sharpMat);
    stellGlowMaterials = [haloMat, sharpMat];
  }

  updateStellStatus(result);
}

function updateStellStatus(result) {
  const changed = stellSelectionChanged();
  stellApply.disabled = !changed || !result;
  if (!result) {
    stellStatus.textContent = "No cells are on";
  } else if (!changed) {
    stellStatus.textContent =
      "The shape as it is · click cells to change it";
  } else {
    stellStatus.textContent =
      result.faces.length +
      " face" +
      (result.faces.length === 1 ? "" : "s") +
      " · " +
      (stellLooksClosed(result.vertices, result.faces)
        ? "closed solid"
        : "not a closed surface");
  }
}

// Diagram cells: fill shows on/off, outline shows the hovered orbit.
function refreshDiagramCells() {
  const colors = stellCellColors();
  stellCellEls.forEach(({ region, el }) => {
    el.setAttribute("fill", region.on ? colors.get(region) : "#18202e");
    el.classList.toggle("hovered", region.orbit === stellHoverOrbit);
  });
}

function stellPolygonPoints(poly) {
  // y flipped so each diagram is seen from outside the shape
  return poly.map((q) => q.x + "," + -q.y).join(" ");
}

// Centre and size of the square framing some cells (in diagram coords).
function stellExtent(cells) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  cells.forEach((r) =>
    r.poly2D.forEach((q) => {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, -q.y);
      maxY = Math.max(maxY, -q.y);
    }),
  );
  return {
    cx: (minX + maxX) / 2 || 0,
    cy: (minY + maxY) / 2 || 0,
    span: Math.max(maxX - minX, maxY - minY) * 1.08 || 1,
  };
}

function buildDiagram(type, typeIndex) {
  const cells = stellRegions.filter((r) => r.face === type.rep);
  const bounded = cells.filter((r) => !r.unbounded);

  const originals = cells.filter((r) => r.isOriginal);
  // Framed on every finite cell, unless those reach so far out that
  // the face itself would be a speck - then on the face, with room
  // around it; scrolling zooms out to the rest.
  const full = stellExtent(bounded.length ? bounded : originals);
  const own = stellExtent(originals);
  const span = Math.min(full.span, own.span * 5);
  const centre = span < full.span ? own : full;
  const view = {
    x: centre.cx - span / 2,
    y: centre.cy - span / 2,
    size: span,
  };

  const wrap = document.createElement("div");
  wrap.className = "stellDiagram";
  const title = document.createElement("div");
  title.className = "stellDiagramTitle";
  title.textContent =
    "Face type " +
    String.fromCharCode(65 + (typeIndex % 26)) +
    " · " +
    type.faces.length +
    " face" +
    (type.faces.length === 1 ? "" : "s");
  wrap.appendChild(title);

  const svg = document.createElementNS(SVG_NS, "svg");
  const setView = () =>
    svg.setAttribute(
      "viewBox",
      view.x + " " + view.y + " " + view.size + " " + view.size,
    );
  setView();

  cells
    .filter((r) => r.unbounded)
    .forEach((r) => {
      const el = document.createElementNS(SVG_NS, "polygon");
      el.setAttribute("points", stellPolygonPoints(r.poly2D));
      el.setAttribute("class", "stellCell unbounded");
      svg.appendChild(el);
    });
  bounded.forEach((r) => {
    const el = document.createElementNS(SVG_NS, "polygon");
    el.setAttribute("points", stellPolygonPoints(r.poly2D));
    el.setAttribute("class", "stellCell");
    el.addEventListener("mouseenter", () => setHoverOrbit(r.orbit));
    el.addEventListener("mouseleave", () => {
      if (stellHoverOrbit === r.orbit) setHoverOrbit(-1);
    });
    el.addEventListener("click", () => toggleOrbit(r));
    svg.appendChild(el);
    stellCellEls.push({ region: r, el });
  });

  // the face as it is now, outlined
  if (originals.length) {
    const loop = mergeFaceCellGroup(originals);
    if (loop.length >= 3) {
      const el = document.createElementNS(SVG_NS, "polygon");
      el.setAttribute("points", stellPolygonPoints(loop));
      el.setAttribute("class", "stellOutline");
      svg.appendChild(el);
    }
  }

  // scroll zooms the diagram about the cursor
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const px = view.x + fx * view.size,
        py = view.y + fy * view.size;
      const factor = Math.exp(e.deltaY * 0.0015);
      view.size = Math.min(
        Math.max(view.size * factor, span * 0.02),
        full.span * 1.5,
      );
      view.x = px - fx * view.size;
      view.y = py - fy * view.size;
      setView();
    },
    { passive: false },
  );

  wrap.appendChild(svg);
  return wrap;
}

function setHoverOrbit(orbit) {
  if (stellHoverOrbit === orbit) return;
  stellHoverOrbit = orbit;
  refreshDiagramCells();
  renderStellationView();
}

function toggleOrbit(region) {
  if (region.orbit < 0) return;
  const on = !region.on;
  stellOrbits[region.orbit].forEach((r) => (r.on = on));
  updateStellResult();
  refreshDiagramCells();
  renderStellationView();
}

function closeStellationPanel(restoreView) {
  if (!stellActive) return;
  stellActive = false;
  stellRegions = null;
  stellOrbits = [];
  stellFaceTypes = [];
  stellCellEls = [];
  stellHoverOrbit = -1;
  stellOriginalColors = null;
  stellResult = null;
  stellDiagrams.innerHTML = "";
  clearStellObjects();
  stellPanel.classList.add("hidden");
  stellMapBtn.classList.remove("active");
  if (restoreView) renderCurrentShape();
}

function openStellationPanel() {
  const shape = currentPolygonShape();
  if (!shape || shape.faces.length === 0) return false;
  const verts = cleanedVertices(shape.verts, shape.faces);
  const regions = computeStellationRegions(verts, shape.faces);
  if (regions.length === 0) {
    infoDiv.textContent = "Couldn't build a stellation map for this shape";
    return false;
  }
  regions.forEach((r) => (r.on = r.isOriginal));
  const { faceTypes, orbits } = stellClassifyCells(
    regions,
    polyhedronRotations(verts, shape.faces),
  );

  stellRegions = regions;
  stellOrbits = orbits;
  stellFaceTypes = faceTypes;
  stellOriginalColors = currentFacePolygons ? faceColors.slice() : null;
  stellCellEls = [];
  stellHoverOrbit = -1;
  stellActive = true;

  stellDiagrams.innerHTML = "";
  faceTypes.forEach((type, i) =>
    stellDiagrams.appendChild(buildDiagram(type, i)),
  );
  stellPanel.classList.remove("hidden");
  stellMapBtn.classList.add("active");
  updateStellResult();
  refreshDiagramCells();
  renderStellationView();
  return true;
}

stellMapBtn.addEventListener("click", () => {
  if (stellActive) {
    closeStellationPanel(true);
    return;
  }
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before mapping stellations";
    return;
  }
  closeTruncationPanel(true);
  setPainting(false);
  openStellationPanel();
});

stellCancel.addEventListener("click", () => closeStellationPanel(true));

stellReset.addEventListener("click", () => {
  if (!stellActive) return;
  stellRegions.forEach((r) => (r.on = r.isOriginal));
  updateStellResult();
  refreshDiagramCells();
  renderStellationView();
});

stellApply.addEventListener("click", () => {
  if (!stellActive || !stellSelectionChanged()) return;
  const action = {
    type: "stellateCells",
    on: stellRegions.flatMap((r, i) => (r.on ? [i] : [])),
    signature: stellMapSignature(stellRegions),
    color: paintColor,
  };
  if (!perform(action))
    infoDiv.textContent = "Those cells don't make a shape - turn some on";
});

// Recorded without face or cell numbers, so it replays on whatever
// shape a universe's parent becomes. The panel reopens on the result,
// ready to go one stellation further.
stellFullBtn.addEventListener("click", () => {
  if (!stellActive) return;
  if (!perform({ type: "stellate", grows: "all", color: paintColor })) {
    infoDiv.textContent =
      "Can't stellate further - some face's next layer of cells runs off to infinity";
    return;
  }
  openStellationPanel();
});
