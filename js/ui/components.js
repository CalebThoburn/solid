// ---------------------------------------------------------------
// Components: a box of saved polyhedra on the left. Save the current
// shape, load a saved one, or ADD one to the current shape: corners in
// the same place merge, so face sets whose edges line up join into one
// shape (see the tags below for which ones close up together).
// ---------------------------------------------------------------
const componentList = document.getElementById("componentList");
const componentsEmpty = document.getElementById("componentsEmpty");
const componentsCount = document.getElementById("componentsCount");
const addComponentBtn = document.getElementById("addComponentBtn");
let components = [];
let allReorderToken = 0;
let reorderBacklog = null; // search results waiting to be added, a batch per press

function uniqueComponentName(base) {
  if (!components.some((c) => c.name === base)) return base;
  let k = 2;
  while (components.some((c) => c.name === base + " (" + k + ")")) k++;
  return base + " (" + k + ")";
}

function polyhedronCounts(comp) {
  const edges = new Set();
  comp.faces.forEach((f) =>
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      edges.add(a < b ? a + "_" + b : b + "_" + a);
    }),
  );
  return (
    comp.verts.length +
    " vertices \u00b7 " +
    edges.size +
    " edges \u00b7 " +
    comp.faces.length +
    " faces" +
    (comp.closed === false ? " \u00b7 open" : "")
  );
}

// ---------------------------------------------------------------
// Tags: which edges a component has, and how many of its faces meet at
// each. Components with exactly the same edges share a letter, and the
// box is sorted by it, so partners sit together; a component also lists
// the others that would close it up (every edge then in exactly two
// faces - e.g. 12 pentagrams + 10 hexagons on the same 30 points).
// Edges are compared by where their ends are, so components saved from
// different shapes still match up.
// ---------------------------------------------------------------
function componentEdgeUse(comp) {
  if (comp.edgeUse) return comp.edgeUse;
  const pointKey = (v) => v.x.toFixed(5) + "," + v.y.toFixed(5) + "," + v.z.toFixed(5);
  const keys = comp.verts.map(pointKey);
  const use = new Map();
  comp.faces.forEach((f) =>
    f.forEach((a, i) => {
      const ka = keys[a],
        kb = keys[f[(i + 1) % f.length]];
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      use.set(key, (use.get(key) || 0) + 1);
    }),
  );
  comp.edgeUse = use;
  comp.edgeSetKey = Array.from(use.keys()).sort().join(";");
  return use;
}

// "1 face per edge", "2 faces per edge (closed)", or a mix.
function facesPerEdgeLabel(use) {
  const counts = new Set(use.values());
  if (counts.size === 1) {
    const c = counts.values().next().value;
    return c === 2 ? "closed \u00b7 2 faces per edge" : c + " face" + (c === 1 ? "" : "s") + " per edge";
  }
  return "mixed: " + Array.from(counts).sort().join("/") + " faces per edge";
}

// Would adding b to a leave every edge in exactly two faces?
function componentsClose(a, b) {
  const ua = componentEdgeUse(a),
    ub = componentEdgeUse(b);
  for (const [k, c] of ua) if (c + (ub.get(k) || 0) !== 2) return false;
  for (const [k, c] of ub) if (!ua.has(k) && c !== 2) return false;
  return true;
}

const EDGE_TAG_COLORS = ["#5ec8ff", "#e0a030", "#9be07a", "#e05a8a", "#b48cff", "#ffd166", "#5fd3c4", "#ff8a65"];

// Components in display order, each with { comp, letter, color, closesWith }.
function taggedComponents() {
  components.forEach(componentEdgeUse);
  // edge sets, lettered in order of fewest edges first
  const sets = Array.from(new Set(components.map((c) => c.edgeSetKey))).sort(
    (x, y) => componentEdgeUse(components.find((c) => c.edgeSetKey === x)).size -
      componentEdgeUse(components.find((c) => c.edgeSetKey === y)).size || (x < y ? -1 : 1),
  );
  const letterOf = new Map(
    sets.map((k, i) => [k, i < 26 ? String.fromCharCode(65 + i) : "#" + (i + 1)]),
  );
  const isClosed = (c) => Array.from(c.edgeUse.values()).every((n) => n === 2);
  return components
    .map((comp) => ({
      comp,
      letter: letterOf.get(comp.edgeSetKey),
      color: EDGE_TAG_COLORS[sets.indexOf(comp.edgeSetKey) % EDGE_TAG_COLORS.length],
      // partners share at least one edge, so look among those
      closesWith: isClosed(comp)
        ? []
        : components.filter(
            (other) =>
              other !== comp &&
              Array.from(other.edgeUse.keys()).some((k) => comp.edgeUse.has(k)) &&
              componentsClose(comp, other),
          ),
    }))
    .sort(
      (x, y) =>
        sets.indexOf(x.comp.edgeSetKey) - sets.indexOf(y.comp.edgeSetKey) ||
        (isClosed(y.comp) ? 1 : 0) - (isClosed(x.comp) ? 1 : 0) ||
        components.indexOf(x.comp) - components.indexOf(y.comp),
    );
}

function shapeAsComponent(shape) {
  const poly = polygonShapeOf(shape);
  if (!poly || poly.faces.length === 0) return null;
  return {
    verts: poly.verts.map((v) => v.clone()),
    faces: poly.faces.map((f) => f.slice()),
    colors: shape.facePolygons
      ? shape.faceColors.slice()
      : poly.faces.map(() => null),
    closed: facesFormClosedSurface(poly.faces),
  };
}

function currentAsComponent() {
  return shapeAsComponent(currentShape());
}

function loadComponentAsShape(comp) {
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before loading a component";
    return;
  }
  perform({ type: "loadComponent", comp: componentForAction(comp) });
}

function addComponentToCurrentShape(comp) {
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before adding a component";
    return;
  }
  if (!perform({ type: "addComponent", comp: componentForAction(comp) }))
    return;
  infoDiv.textContent = "Added " + comp.name + " to the shape";
}

function renderComponentList() {
  componentList.innerHTML = "";
  componentsCount.textContent = "(" + components.length + ")";
  componentsEmpty.style.display = components.length ? "none" : "block";
  taggedComponents().forEach(({ comp, letter, color, closesWith }) => {
    const row = document.createElement("div");
    row.className = "compRow";
    const name = document.createElement("div");
    name.className = "compName";
    name.textContent = comp.name;
    const meta = document.createElement("div");
    meta.className = "compMeta";
    meta.textContent = polyhedronCounts(comp);
    const tags = document.createElement("div");
    tags.className = "compTags";
    const tag = (text, title, style) => {
      const t = document.createElement("span");
      t.className = "compTag";
      t.textContent = text;
      t.title = title;
      if (style) Object.assign(t.style, style);
      tags.appendChild(t);
      return t;
    };
    tag("Edges " + letter, "Components with the same letter have exactly the same edges", {
      color,
      borderColor: color,
    });
    tag(facesPerEdgeLabel(comp.edgeUse), "How many of its faces meet at each edge");
    if (closesWith.length)
      tag(
        "closes with " + closesWith.map((c) => c.name).join(", "),
        "Adding one of these leaves every edge in exactly two faces: a closed shape",
      ).classList.add("closes");
    const btns = document.createElement("div");
    btns.className = "compBtns";
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.className = "compBtn";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      btns.appendChild(b);
    };
    mk(
      "Add",
      "Add this polyhedron to the current shape (shared corners and edges join up)",
      () => addComponentToCurrentShape(comp),
    );
    mk("Load", "Replace the current shape with this one", () =>
      loadComponentAsShape(comp),
    );
    mk("\u2715", "Remove from components", () => {
      components.splice(components.indexOf(comp), 1);
      renderComponentList();
    });
    row.appendChild(name);
    row.appendChild(meta);
    row.appendChild(tags);
    row.appendChild(btns);
    componentList.appendChild(row);
  });
}

addComponentBtn.addEventListener("click", () => {
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before saving the shape";
    return;
  }
  const comp = currentAsComponent();
  if (!comp) return;
  const sig = polyhedronSignature(comp.verts, comp.faces);
  if (components.some((c) => polyhedronSignature(c.verts, c.faces) === sig)) {
    infoDiv.textContent = "That shape is already in the components box";
    return;
  }
  const base = currentSolidName
    ? currentSolidName.charAt(0).toUpperCase() + currentSolidName.slice(1)
    : "Shape";
  comp.name = uniqueComponentName(base);
  components.push(comp);
  renderComponentList();
  infoDiv.textContent = "Saved " + comp.name + " to components";
});

// Adds the next batch of the stored search results to the components
// box. A big shape can have thousands of (mostly open) reorderings, so
// they come 100 at a time; press the button again for more.
function addReorderingBatch() {
  const BATCH = 100;
  const bl = reorderBacklog;
  if (!bl) return;
  if (bl.next >= bl.results.length) {
    infoDiv.textContent =
      "Every uniform reordering of these points has already been added";
    return;
  }
  const colour = paintColor;
  let added = 0,
    already = 0;
  while (bl.next < bl.results.length && added < BATCH) {
    const res = bl.results[bl.next++];
    const wound = normalizeFaceWinding(bl.points, res.faces);
    const pruned = pruneUnusedVertices(bl.points, wound);
    const sig = polyhedronSignature(pruned.vertices, pruned.faces);
    if (components.some((c) => polyhedronSignature(c.verts, c.faces) === sig)) {
      already++;
      continue;
    }
    components.push({
      name: uniqueComponentName(
        reorderingName(pruned.faces.length, res.sides, res.step),
      ),
      verts: pruned.vertices,
      faces: pruned.faces,
      colors: pruned.faces.map(() => colour),
      closed: res.closed,
    });
    added++;
  }
  renderComponentList();
  const left = bl.results.length - bl.next;
  infoDiv.textContent =
    "Added " +
    added +
    " uniform reordering" +
    (added === 1 ? "" : "s") +
    " to components (closed ones first)" +
    (already ? ", " + already + " already there" : "") +
    (left > 0
      ? " \u00b7 " + left + " more - press again for the next batch"
      : " \u00b7 that's all of them");
}

// Searches for every uniform reordering of the points (see
// enumerateUniformReorderingsGen) to the box, searching in small slices
// so the page stays responsive on big shapes.
allReorderBtn.addEventListener("click", () => {
  if (mode !== "custom" || allReorderBtn.disabled) return;
  if (!symmetryPerms || symmetryPerms.length <= 1) {
    infoDiv.textContent =
      "These points have no symmetry, so there are no uniform reorderings to add";
    return;
  }
  if (reorderBacklog) {
    addReorderingBatch();
    return;
  }
  const token = ++allReorderToken;
  const points = currentVerts.map((v) => v.clone());
  const gen = enumerateUniformReorderingsGen(points, symmetryPerms);
  const label = allReorderBtn.textContent;
  allReorderBtn.disabled = true;
  allReorderBtn.textContent = "Searching\u2026";

  function stop() {
    allReorderBtn.disabled = false;
    allReorderBtn.textContent = label;
  }
  function finish(outcome) {
    stop();
    // Closed surfaces first, then the simplest faces first, plain
    // polygons before stars, fewer faces before more.
    const sorted = outcome.results
      .slice()
      .sort(
        (x, y) =>
          (y.closed ? 1 : 0) - (x.closed ? 1 : 0) ||
          x.sides - y.sides ||
          x.step - y.step ||
          x.faces.length - y.faces.length,
      );
    if (sorted.length === 0) {
      infoDiv.textContent = "These points have no uniform reorderings";
      return;
    }
    reorderBacklog = { points, results: sorted, next: 0 };
    addReorderingBatch();
  }
  function slice() {
    if (token !== allReorderToken || mode !== "custom") {
      stop();
      return;
    }
    const until = performance.now() + 30;
    let last = null;
    for (;;) {
      const step = gen.next();
      if (step.done) {
        finish(step.value);
        return;
      }
      last = step.value;
      if (performance.now() > until) break;
    }
    infoDiv.textContent =
      "Searching uniform reorderings\u2026 " +
      last.scanned +
      " candidate faces checked, " +
      last.results.length +
      " found";
    setTimeout(slice, 0);
  }
  slice();
});

renderComponentList();
