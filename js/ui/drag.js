// ---------------------------------------------------------------
// Mouse-drag rotation around the origin, plus click-to-select
// ---------------------------------------------------------------
let isDragging = false;
let dragMoved = false;
let prevX = 0;
let prevY = 0;
let downX = 0;
let downY = 0;

const rotationSpeed = 0.005;
const dragThreshold = 4;

// Rotate around fixed world-space axes (screen-horizontal and
// screen-vertical), applied via quaternion premultiply. Accumulating
// local Euler angles instead (worldGroup.rotation.x/y +=) causes drag
// direction to invert once the object has been rotated far enough
// (e.g. upside down) - premultiplying by a world-space delta keeps
// "drag left" always meaning the same thing on screen, no matter how
// the shape is currently oriented.
const worldUp = new THREE.Vector3(0, 1, 0);
const worldRight = new THREE.Vector3(1, 0, 0);
const dragYaw = new THREE.Quaternion();
const dragPitch = new THREE.Quaternion();

function applyDragRotation(dx, dy) {
  dragYaw.setFromAxisAngle(worldUp, dx * rotationSpeed);
  dragPitch.setFromAxisAngle(worldRight, dy * rotationSpeed);
  worldGroup.quaternion.premultiply(dragYaw);
  worldGroup.quaternion.premultiply(dragPitch);
}

renderer.domElement.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragMoved = false;
  prevX = downX = e.clientX;
  prevY = downY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;

  if (
    Math.abs(e.clientX - downX) > dragThreshold ||
    Math.abs(e.clientY - downY) > dragThreshold
  ) {
    dragMoved = true;
  }

  applyDragRotation(dx, dy);
});

window.addEventListener("mouseup", (e) => {
  if (isDragging && !dragMoved) {
    if (mode === "custom") trySelectPointAt(e.clientX, e.clientY);
    else if (painting) tryPaintFaceAt(e.clientX, e.clientY);
  }
  isDragging = false;
});

// Touch support (single-finger drag to rotate, tap to select)
let lastTouchX = 0;
let lastTouchY = 0;
let touchDownX = 0;
let touchDownY = 0;
let touchMoved = false;

renderer.domElement.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    lastTouchX = touchDownX = e.touches[0].clientX;
    lastTouchY = touchDownY = e.touches[0].clientY;
    touchMoved = false;
  }
});

renderer.domElement.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;

      if (
        Math.abs(e.touches[0].clientX - touchDownX) > dragThreshold ||
        Math.abs(e.touches[0].clientY - touchDownY) > dragThreshold
      ) {
        touchMoved = true;
      }

      applyDragRotation(dx, dy);
      e.preventDefault();
    }
  },
  { passive: false },
);

renderer.domElement.addEventListener("touchend", () => {
  if (!touchMoved) {
    if (mode === "custom") trySelectPointAt(lastTouchX, lastTouchY);
    else if (painting) tryPaintFaceAt(lastTouchX, lastTouchY);
  }
});

// Scroll to zoom
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const zoomSpeed = 0.001;
    const newZ = camera.position.z * (1 + e.deltaY * zoomSpeed);
    camera.position.z = Math.min(Math.max(newZ, 2), 60);
  },
  { passive: false },
);
