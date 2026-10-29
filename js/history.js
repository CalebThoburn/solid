// ---------------------------------------------------------------
// Universes, actions and undo / redo.
//
// The multiverse is a tree of universes. Each one starts from a seed
// shape - its parent's current shape (the first universe's seed is the
// starting dodecahedron) - and keeps the list of actions done in it:
//   history[0]   = the seed
//   history[i]   = the shape after actions[0..i-1]
//   historyIndex = how far along it currently is (undo/redo move it)
// Whenever a universe's current shape changes, every universe below it
// is rebuilt by replaying its own actions on the new seed; an action
// that no longer applies is skipped (and marked on the map).
// Only finalized shape changes are recorded (loading a solid, a dual, a
// finished reorder session, ...) - not every click while building a face.
// ---------------------------------------------------------------
let universes = [];
let activeUniverse = null;
let nextUniverseNumber = 1;

function makeUniverse(parent, seed) {
  const universe = {
    number: nextUniverseNumber++,
    parent,
    children: [],
    actions: [],
    skipped: [], // skipped[i]: actions[i] didn't apply on this seed
    history: [seed],
    historyIndex: 0,
  };
  universes.push(universe);
  if (parent) parent.children.push(universe);
  return universe;
}

function universeShape(universe) {
  return universe.history[universe.historyIndex];
}

function currentShape() {
  return universeShape(activeUniverse);
}

function updateUndoRedoButtons() {
  if (!activeUniverse) return;
  undoBtn.disabled = activeUniverse.historyIndex <= 0;
  redoBtn.disabled =
    activeUniverse.historyIndex >= activeUniverse.history.length - 1;
}

function tryAction(shape, action) {
  try {
    return runAction(shape, action);
  } catch (err) {
    return null;
  }
}

// Does an action in the current universe and shows the result. Returns
// false (changing nothing) if it doesn't apply to the current shape.
function perform(action) {
  const next = tryAction(currentShape(), action);
  if (!next) return false;
  const u = activeUniverse;
  u.actions = u.actions.slice(0, u.historyIndex).concat([action]);
  u.skipped = u.skipped.slice(0, u.historyIndex).concat([false]);
  u.history = u.history.slice(0, u.historyIndex + 1).concat([next]);
  u.historyIndex++;
  showShape(next);
  rebuildDescendants(u);
  return true;
}

// Replays every universe below `universe` on its (possibly new) seed.
function rebuildDescendants(universe) {
  universe.children.forEach((child) => {
    let shape = universeShape(universe);
    child.history = [shape];
    child.skipped = child.actions.map((action) => {
      const next = tryAction(shape, action);
      if (next) shape = next;
      child.history.push(shape);
      return !next;
    });
    rebuildDescendants(child);
  });
}

function moveHistory(index) {
  activeUniverse.historyIndex = index;
  showShape(currentShape());
  rebuildDescendants(activeUniverse);
}

function undo() {
  if (activeUniverse.historyIndex <= 0) return;
  moveHistory(activeUniverse.historyIndex - 1);
}

function redo() {
  if (activeUniverse.historyIndex >= activeUniverse.history.length - 1) return;
  moveHistory(activeUniverse.historyIndex + 1);
}

function enterUniverse(universe) {
  activeUniverse = universe;
  showShape(currentShape());
  updateMultiverseButton();
}

// A new universe branching off `parent`, seeded with its current shape.
function addChildUniverse(parent) {
  return makeUniverse(parent, universeShape(parent));
}

// Removes a universe and every universe branched from it. If you were
// in one of them, you move to the removed universe's parent. The first
// universe can't be removed. Returns how many universes were removed.
function deleteUniverse(universe) {
  if (!universe.parent) return 0;
  const removed = new Set();
  (function collect(u) {
    removed.add(u);
    u.children.forEach(collect);
  })(universe);
  const parent = universe.parent;
  parent.children = parent.children.filter((c) => c !== universe);
  universes = universes.filter((u) => !removed.has(u));
  removed.forEach(forgetThumb);
  if (pinnedUniverse && removed.has(pinnedUniverse)) setPinnedUniverse(null);
  if (removed.has(activeUniverse)) enterUniverse(parent);
  return removed.size;
}
