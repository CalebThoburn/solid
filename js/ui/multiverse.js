// ---------------------------------------------------------------
// Multiverse map (Esc): every universe as a plaque in a tree, parents
// on the left, children to their right. Each plaque shows its shape
// spinning; click a plaque to enter that universe, + to branch a new
// child universe off it.
// ---------------------------------------------------------------
const multiverseEl = document.getElementById("multiverse");
const mvScroll = document.getElementById("mvScroll");
const mvTree = document.getElementById("mvTree");
const mvLinks = document.getElementById("mvLinks");
const multiverseBtn = document.getElementById("multiverseBtn");
let multiverseOpen = false;
let mvPlaques = []; // { universe, canvas, ctx } for every plaque on the map

const PLAQUE_W = 250;
const PLAQUE_H = 236;
const COL_GAP = 70;
const ROW_GAP = 22;
const TREE_PAD = 32;
const THUMB_W = 184;
const THUMB_H = 120;

// One small offscreen renderer draws every plaque's shape in turn and
// copies it onto that plaque's canvas - one WebGL context however many
// universes there are.
const thumbDpr = Math.min(window.devicePixelRatio || 1, 2);
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
thumbRenderer.setPixelRatio(1);
thumbRenderer.setSize(THUMB_W * thumbDpr, THUMB_H * thumbDpr, false);
const thumbScene = new THREE.Scene();
thumbScene.add(new THREE.AmbientLight(0xffffff, 0.55));
const thumbLight = new THREE.DirectionalLight(0xffffff, 0.7);
thumbLight.position.set(4, 6, 5);
thumbScene.add(thumbLight);
const thumbCamera = new THREE.PerspectiveCamera(
  35,
  THUMB_W / THUMB_H,
  0.1,
  500,
);
const thumbHolder = new THREE.Group();
thumbScene.add(thumbHolder);
const thumbCache = new Map(); // universe -> { shape, objects, size }

function disposeThumb(entry) {
  entry.objects.forEach((o) => {
    o.geometry.dispose();
    o.material.dispose();
  });
}

function forgetThumb(universe) {
  const cached = thumbCache.get(universe);
  if (cached) disposeThumb(cached);
  thumbCache.delete(universe);
}

// Draws a universe's shape, turned by `quaternion`, onto a 2D canvas.
function drawThumb(universe, quaternion, ctx, canvas, shape) {
  const thumb = thumbFor(universe, shape);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (thumb.objects.length === 0) return;
  thumbHolder.clear();
  thumb.objects.forEach((o) => thumbHolder.add(o));
  thumbHolder.quaternion.copy(quaternion);
  // Far enough back that the shape's bounding sphere fits the frame.
  thumbCamera.position.set(0, 0, thumb.size * 3.6);
  thumbCamera.lookAt(0, 0, 0);
  thumbRenderer.render(thumbScene, thumbCamera);
  ctx.drawImage(thumbRenderer.domElement, 0, 0, canvas.width, canvas.height);
}

// The mesh + edges for a universe's current shape (or `shape`, e.g. a
// preview of it), rebuilt only when that shape has changed.
function thumbFor(universe, shape = universeShape(universe)) {
  const cached = thumbCache.get(universe);
  if (cached && cached.shape === shape) return cached;
  if (cached) disposeThumb(cached);
  const objects = [];
  const geometry = geometryForShape(shape);
  if (geometry && geometry.attributes.position.count > 0) {
    const material = faceMaterial();
    if (geometry.attributes.color) {
      material.vertexColors = true;
      material.color.setHex(0xffffff);
    }
    objects.push(new THREE.Mesh(geometry, material));
    objects.push(
      new THREE.LineSegments(
        faceEdgeLines(geometry),
        new THREE.LineBasicMaterial({ color: 0x9fd3ff }),
      ),
    );
  }
  const entry = { shape, objects, size: shapeSize(shape.verts) || 1 };
  thumbCache.set(universe, entry);
  return entry;
}

function renderThumbs() {
  if (!multiverseOpen) return;
  requestAnimationFrame(renderThumbs);
  const spin = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.45, performance.now() * 0.0006, 0),
  );
  mvPlaques.forEach(({ universe, canvas, ctx }) =>
    drawThumb(universe, spin, ctx, canvas),
  );
}

// Each universe's grid position: leaves take one row each, top to
// bottom; a parent sits level with the middle of its children.
function layoutUniverses(root) {
  const pos = new Map();
  let rows = 0;
  let depth = 0;
  (function place(u, d) {
    depth = Math.max(depth, d);
    if (u.children.length === 0) {
      pos.set(u, { col: d, row: rows++ });
      return;
    }
    u.children.forEach((c) => place(c, d + 1));
    const first = pos.get(u.children[0]).row;
    const last = pos.get(u.children[u.children.length - 1]).row;
    pos.set(u, { col: d, row: (first + last) / 2 });
  })(root, 0);
  return { pos, rows, cols: depth + 1 };
}

// The steps done in a universe so far, as plaque chips: repeats in a
// row collapse ("Paint ×4"), and a step that couldn't be replayed
// on the current seed is shown struck out.
function trailChips(universe) {
  const chips = [];
  for (let i = 0; i < universe.historyIndex; i++) {
    const label = actionLabel(universe.actions[i]);
    const skipped = universe.skipped[i];
    const last = chips[chips.length - 1];
    if (last && last.label === label && last.skipped === skipped) last.count++;
    else chips.push({ label, skipped, count: 1 });
  }
  return chips;
}

function buildPlaque(universe, x, y) {
  const plaque = document.createElement("div");
  plaque.className = "plaque" + (universe === activeUniverse ? " active" : "");
  plaque.style.left = x + "px";
  plaque.style.top = y + "px";
  plaque.style.width = PLAQUE_W + "px";
  plaque.style.height = PLAQUE_H + "px";
  plaque.tabIndex = 0;
  plaque.title = "Enter Universe " + universe.number;

  const main = document.createElement("div");
  main.className = "plaqueMain";

  const head = document.createElement("div");
  head.className = "plaqueHead";
  const name = document.createElement("span");
  name.className = "plaqueName";
  name.textContent = "Universe " + universe.number;
  head.appendChild(name);
  if (universe === activeUniverse) {
    const here = document.createElement("span");
    here.className = "plaqueHere";
    here.textContent = "you are here";
    head.appendChild(here);
  }
  const tools = document.createElement("span");
  tools.className = "universeTools";
  tools.appendChild(pinButton(universe));
  if (universe.parent)
    tools.appendChild(
      deleteButton(universe, () => {
        renderMultiverseMap();
        scrollToUniverse(activeUniverse);
      }),
    );
  head.appendChild(tools);

  const canvas = document.createElement("canvas");
  canvas.className = "plaqueThumb";
  canvas.width = THUMB_W * thumbDpr;
  canvas.height = THUMB_H * thumbDpr;
  canvas.style.width = THUMB_W + "px";
  canvas.style.height = THUMB_H + "px";

  const trail = document.createElement("div");
  trail.className = "plaqueTrail";
  const seed = document.createElement("span");
  seed.className = "chip seed";
  seed.textContent = universe.parent
    ? "from Universe " + universe.parent.number
    : "start";
  trail.appendChild(seed);
  const chips = trailChips(universe);
  const MAX_CHIPS = 5;
  if (chips.length > MAX_CHIPS) {
    const more = document.createElement("span");
    more.className = "chip more";
    more.textContent = "…";
    trail.appendChild(more);
  }
  chips.slice(-MAX_CHIPS).forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (c.skipped ? " skipped" : "");
    chip.textContent = c.label + (c.count > 1 ? " ×" + c.count : "");
    if (c.skipped)
      chip.title = "Doesn't apply to the new seed shape, so it was skipped";
    trail.appendChild(chip);
  });

  const meta = document.createElement("div");
  meta.className = "plaqueMeta";
  const comp = shapeAsComponent(universeShape(universe));
  meta.textContent = comp ? polyhedronCounts(comp) : "no faces";

  main.append(head, canvas, trail, meta);

  const add = document.createElement("button");
  add.className = "plaqueAdd";
  add.textContent = "+";
  add.title = "Branch a new universe from this one";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    const child = addChildUniverse(universe);
    renderMultiverseMap();
    scrollToUniverse(child);
  });

  plaque.append(main, add);
  plaque.addEventListener("click", () => {
    enterUniverse(universe);
    closeMultiverse();
  });
  plaque.addEventListener("keydown", (e) => {
    // Enter on one of its buttons is that button's, not the plaque's
    if (e.key === "Enter" && e.target === plaque) plaque.click();
  });

  mvPlaques.push({
    universe,
    canvas,
    ctx: canvas.getContext("2d"),
    el: plaque,
  });
  return plaque;
}

// A universe's delete button (on its plaque, and on its card in the
// children strip): the first click asks, a second within a few seconds
// deletes the universe and everything branched from it, then calls
// `afterDelete`.
function deleteButton(universe, afterDelete) {
  const btn = document.createElement("button");
  btn.className = "plaqueDelete";
  btn.textContent = "\u00d7";
  btn.title = "Delete this universe";
  let disarm = null;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!btn.classList.contains("armed")) {
      let count = 0;
      (function walk(u) {
        count++;
        u.children.forEach(walk);
      })(universe);
      btn.classList.add("armed");
      btn.textContent = count > 1 ? "Delete all " + count + "?" : "Delete?";
      btn.title =
        count > 1
          ? "Also deletes the " + (count - 1) + " universe(s) branched from it"
          : "Click again to delete";
      disarm = setTimeout(() => {
        btn.classList.remove("armed");
        btn.textContent = "\u00d7";
        btn.title = "Delete this universe";
      }, 3000);
      return;
    }
    clearTimeout(disarm);
    deleteUniverse(universe);
    if (afterDelete) afterDelete();
  });
  return btn;
}

function renderMultiverseMap() {
  mvTree.querySelectorAll(".plaque").forEach((p) => p.remove());
  mvPlaques = [];
  const root = universes[0];
  const { pos, rows, cols } = layoutUniverses(root);
  const px = (u) => TREE_PAD + pos.get(u).col * (PLAQUE_W + COL_GAP);
  const py = (u) => TREE_PAD + pos.get(u).row * (PLAQUE_H + ROW_GAP);

  const width = TREE_PAD * 2 + cols * PLAQUE_W + (cols - 1) * COL_GAP;
  const height = TREE_PAD * 2 + rows * PLAQUE_H + (rows - 1) * ROW_GAP;
  mvTree.style.width = width + "px";
  mvTree.style.height = height + "px";
  mvLinks.setAttribute("width", width);
  mvLinks.setAttribute("height", height);

  // A curve from each parent's + strip to the left edge of each child.
  let paths = "";
  universes.forEach((u) => {
    if (!u.parent) return;
    const x1 = px(u.parent) + PLAQUE_W;
    const y1 = py(u.parent) + PLAQUE_H / 2;
    const x2 = px(u);
    const y2 = py(u) + PLAQUE_H / 2;
    const mid = (x1 + x2) / 2;
    paths +=
      '<path d="M' +
      x1 +
      " " +
      y1 +
      " C" +
      mid +
      " " +
      y1 +
      " " +
      mid +
      " " +
      y2 +
      " " +
      x2 +
      " " +
      y2 +
      '" />';
  });
  mvLinks.innerHTML = paths;

  universes.forEach((u) => mvTree.appendChild(buildPlaque(u, px(u), py(u))));
}

function scrollToUniverse(universe) {
  const p = mvPlaques.find((p) => p.universe === universe);
  if (p) p.el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateMultiverseButton() {
  multiverseBtn.textContent = "◈ Universe " + activeUniverse.number;
}

function openMultiverse() {
  if (mode === "custom") {
    infoDiv.textContent = "Exit reorder mode before opening the multiverse";
    return;
  }
  closeTruncationPanel(true);
  closeStellationPanel(true);
  multiverseOpen = true;
  multiverseEl.classList.remove("hidden");
  renderMultiverseMap();
  scrollToUniverse(activeUniverse);
  mvPlaques
    .find((p) => p.universe === activeUniverse)
    .el.focus({
      preventScroll: true,
    });
  requestAnimationFrame(renderThumbs);
}

function closeMultiverse() {
  multiverseOpen = false;
  multiverseEl.classList.add("hidden");
  updateMultiverseButton();
}

multiverseBtn.addEventListener("click", openMultiverse);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!modalOverlay.classList.contains("hidden")) return; // the dialog is up
  e.preventDefault();
  if (multiverseOpen) closeMultiverse();
  else openMultiverse();
});
