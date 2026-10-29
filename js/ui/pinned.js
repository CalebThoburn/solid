// ---------------------------------------------------------------
// Pinned universe: a pin button on any plaque or child card shows that
// universe's shape large in the bottom-right corner, kept live - turned
// as you turn your own shape, and following the truncation slider's
// preview when it's one of your children. One universe is pinned at a
// time; pinning another replaces it. Clicking the view enters it.
// ---------------------------------------------------------------
const pinnedView = document.getElementById("pinnedView");
const pinnedName = document.getElementById("pinnedName");
const pinnedNote = document.getElementById("pinnedNote");
const pinnedClose = document.getElementById("pinnedClose");
let pinnedUniverse = null;

const PIN_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path d="M6 1.5h4l-.6 4.2 2.6 2.6v1.2H8.6V15h-1.2V9.5H4V8.3l2.6-2.6z" fill="currentColor"/></svg>';

// Its own renderer, sized to the view, so the shape is drawn sharp
// rather than stretched up from a thumbnail. Same proportions as the
// thumbnails, so it shares their camera.
const pinRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
pinRenderer.setPixelRatio(thumbDpr);
pinRenderer.domElement.id = "pinnedCanvas";
pinnedView.appendChild(pinRenderer.domElement);

// As big as fits in the bottom-right corner: about a third of the
// screen's width, and no taller than the space under the menu (which
// grows and shrinks as its sections open). When the menu leaves too
// little room under it, the view sits just left of the menu instead.
const PIN_HEAD_H = 40; // the view's title row and padding
const PIN_MIN_H = 170;
function sizePinnedView() {
  const menu = document.getElementById("menu").getBoundingClientRect();
  const ratio = THUMB_W / THUMB_H;
  const room = window.innerHeight - menu.bottom - 24 - PIN_HEAD_H;
  let w = Math.min(Math.max(window.innerWidth * 0.3, 260), 460);
  let right = 12;
  if (room >= PIN_MIN_H) {
    w = Math.min(w, room * ratio);
  } else {
    right = window.innerWidth - menu.left + 12;
    w = Math.min(w, window.innerHeight * 0.5 * ratio);
  }
  w = Math.round(w);
  const h = Math.round(w / ratio);
  pinRenderer.setSize(w, h);
  pinnedView.style.right = right + "px";
  // keep the children strip clear of the view
  document.documentElement.style.setProperty(
    "--pin-space",
    pinnedUniverse ? right + w + 28 + "px" : "0px",
  );
}
window.addEventListener("resize", sizePinnedView);
new ResizeObserver(() => {
  if (pinnedUniverse) sizePinnedView();
}).observe(document.getElementById("menu"));

function pinButton(universe) {
  const btn = document.createElement("button");
  btn.className = "pinBtn";
  btn.innerHTML = PIN_ICON;
  btn.dataset.universe = universe.number;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setPinnedUniverse(pinnedUniverse === universe ? null : universe);
  });
  refreshPinButton(btn);
  return btn;
}

function refreshPinButton(btn) {
  const on = pinnedUniverse && Number(btn.dataset.universe) === pinnedUniverse.number;
  btn.classList.toggle("active", !!on);
  btn.title = on ? "Unpin" : "Pin to the corner of the screen";
}

function setPinnedUniverse(universe) {
  pinnedUniverse = universe;
  pinnedView.classList.toggle("hidden", !universe);
  if (universe) pinnedName.textContent = "Universe " + universe.number;
  sizePinnedView();
  document.querySelectorAll(".pinBtn").forEach(refreshPinButton);
}

pinnedClose.addEventListener("click", (e) => {
  e.stopPropagation();
  setPinnedUniverse(null);
});
pinnedView.addEventListener("click", () => {
  if (pinnedUniverse && pinnedUniverse !== activeUniverse)
    enterUniverse(pinnedUniverse);
});

// Called every frame from animate().
function renderPinnedView() {
  if (!pinnedUniverse || multiverseOpen) return;
  const preview = childPreviews && childPreviews.get(pinnedUniverse);
  const note =
    pinnedUniverse === activeUniverse
      ? "you are here"
      : preview
        ? preview.pending
          ? "updating…"
          : "preview"
        : "";
  if (pinnedNote.textContent !== note) pinnedNote.textContent = note;
  pinnedView.classList.toggle("here", pinnedUniverse === activeUniverse);

  const thumb = thumbFor(pinnedUniverse, preview ? preview.shape : undefined);
  thumbHolder.clear();
  thumb.objects.forEach((o) => thumbHolder.add(o));
  thumbHolder.quaternion.copy(worldGroup.quaternion);
  thumbCamera.position.set(0, 0, thumb.size * 3.6);
  thumbCamera.lookAt(0, 0, 0);
  pinRenderer.render(thumbScene, thumbCamera);
}
