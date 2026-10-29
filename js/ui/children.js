// ---------------------------------------------------------------
// Children strip: along the bottom of the screen, every universe that
// branches off the one you're in, drawn live - so a change made here
// can be seen replaying into each child as it happens. Each child is
// turned exactly as you've turned the shape, and clicking one enters it.
// ---------------------------------------------------------------
const childStrip = document.getElementById("childStrip");
let childCards = []; // { universe, canvas, ctx, last } in strip order
// While a change is being previewed here (the truncation slider), each
// child replayed onto the previewed shape: universe -> { shape, pending }.
let childPreviews = null;
let childPreviewSeed = null;
let childPreviewTimer = null;

const CHILD_W = 138;
const CHILD_H = 90;

// What a child shows under its picture: its latest step, struck out if
// it no longer applies to the parent's current shape.
function childLastStep(universe) {
  const i = universe.historyIndex - 1;
  if (i < 0) return { text: "no changes yet", skipped: false };
  return {
    text:
      actionLabel(universe.actions[i]) +
      (universe.historyIndex > 1 ? " (+" + (universe.historyIndex - 1) + " before)" : ""),
    skipped: universe.skipped[i],
  };
}

function buildChildStrip(children) {
  childStrip.innerHTML = "";
  childCards = children.map((universe) => {
    // not a <button>: it holds the pin and delete buttons
    const card = document.createElement("div");
    card.className = "childCard";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.title = "Enter Universe " + universe.number;
    const head = document.createElement("div");
    head.className = "childHead";
    const name = document.createElement("span");
    name.className = "childName";
    name.textContent = "Universe " + universe.number;
    const tools = document.createElement("span");
    tools.className = "universeTools";
    tools.append(pinButton(universe), deleteButton(universe));
    head.append(name, tools);
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W * thumbDpr;
    canvas.height = THUMB_H * thumbDpr;
    canvas.style.width = CHILD_W + "px";
    canvas.style.height = CHILD_H + "px";
    const last = document.createElement("div");
    last.className = "childLast";
    card.append(head, canvas, last);
    card.addEventListener("click", () => enterUniverse(universe));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === card) enterUniverse(universe);
    });
    childStrip.appendChild(card);
    return { universe, canvas, ctx: canvas.getContext("2d"), last };
  });
  childStrip.classList.toggle("hidden", children.length === 0);
}

// Called every frame from animate().
function renderChildStrip() {
  if (!activeUniverse || multiverseOpen) return;
  const children = activeUniverse.children;
  if (
    children.length !== childCards.length ||
    children.some((c, i) => childCards[i].universe !== c)
  )
    buildChildStrip(children);
  childCards.forEach((card) => {
    const step = childLastStep(card.universe);
    const preview = childPreviews && childPreviews.get(card.universe);
    const text = preview && preview.pending ? "updating\u2026" : step.text;
    if (card.last.textContent !== text) card.last.textContent = text;
    card.last.classList.toggle("skipped", step.skipped && !preview);
    drawThumb(
      card.universe,
      worldGroup.quaternion,
      card.ctx,
      card.canvas,
      preview ? preview.shape : undefined,
    );
  });
}

// Replays a child's steps onto `seed`. With `quick`, a stellation that
// needs a full rebuild is put off: the replay stops there, `pending`.
function replayChild(child, seed, quick) {
  let shape = seed;
  let pending = false;
  stellFastOnly = quick;
  try {
    for (let i = 0; i < child.historyIndex; i++) {
      const next = tryAction(shape, child.actions[i]);
      if (next === STELL_PENDING) {
        pending = true;
        break;
      }
      if (next) shape = next;
    }
  } finally {
    stellFastOnly = false;
  }
  return { shape, pending };
}

// Shows every child as it would be if the current universe's shape
// became `seed` (null ends the preview). Anything that needs a slow
// rebuild is done once the preview has stopped changing for a moment,
// so dragging a slider stays smooth.
function previewChildren(seed) {
  clearTimeout(childPreviewTimer);
  if (!seed || !activeUniverse || activeUniverse.children.length === 0) {
    childPreviews = null;
    childPreviewSeed = null;
    return;
  }
  const previous = childPreviews;
  childPreviews = new Map();
  childPreviewSeed = seed;
  let anyPending = false;
  activeUniverse.children.forEach((child) => {
    const replay = replayChild(child, seed, true);
    if (replay.pending) {
      anyPending = true;
      // keep showing the last finished preview until this one is ready
      const last = previous && previous.get(child);
      replay.shape = last ? last.shape : universeShape(child);
    }
    childPreviews.set(child, replay);
  });
  if (anyPending)
    childPreviewTimer = setTimeout(() => {
      if (childPreviewSeed !== seed) return;
      activeUniverse.children.forEach((child) => {
        if (childPreviews.get(child).pending)
          childPreviews.set(child, replayChild(child, seed, false));
      });
    }, 250);
}
