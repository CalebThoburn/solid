// ---------------------------------------------------------------
// Scene state
// ---------------------------------------------------------------
let currentSolidName = null; // name of the named solid, or null once custom
let currentVerts = []; // THREE.Vector3[] - vertices of the current shape
let currentFacePolygons = null; // index-array[] (n-gon per face) once custom; null = "use SOLID_GEOMETRIES[currentSolidName]() directly"
let vertexSpheres = []; // Mesh[] parallel to currentVerts
let faceMeshObjects = []; // [Mesh, LineSegments] currently shown for faces
let mode = "original"; // "original" | "custom" (actively reordering)
let pendingFaceColors = []; // selected colour at the moment each pending face was made
let vertexColorHex = []; // colour each point is shown in while reordering (what resetSphereColor restores)
let globalColorHex = []; // ...the "overall symmetry" colouring: points that are symmetrically alike share one
let symmetryPerms = null; // every symmetry of the point set, as permutations (computed on entering reorder mode)
let colorRelative = false; // Tab toggles: false = overall symmetry, true = as seen from the selected point
let lastUserFace = null; // the last face the user made by hand (what "create face uniformly" copies)
let lastUserFaceColor = null;
let pendingFacePolygons = []; // faces built so far in the current reorder session
let selectedIndices = []; // indices selected for the face currently being built
let currentSolidScale = 1; // scale applied to a named solid's raw geometry to match the previous shape's size
let faceColors = []; // hex string (or null = default) per polygon face of currentFacePolygons
let paintColor = "#2b6fb8"; // selected colour: used for painting and for faces made by reorder / truncation
let painting = false; // paint mode: clicking a face colours it
let dualCentre = null; // point the last dual was reciprocated about (in current coords); reused so dual-of-dual returns the original shape

// Centre of a shape's bounding box, and its "size" = the farthest vertex
// from that centre. Used to re-centre and re-scale after a dual so the
// shape stays the centre of rotation and fills the same amount of view.
function boundsCentre(verts) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  verts.forEach((v) => {
    min.x = Math.min(min.x, v.x);
    min.y = Math.min(min.y, v.y);
    min.z = Math.min(min.z, v.z);
    max.x = Math.max(max.x, v.x);
    max.y = Math.max(max.y, v.y);
    max.z = Math.max(max.z, v.z);
  });
  return min.add(max).multiplyScalar(0.5);
}

function shapeSize(verts) {
  if (verts.length === 0) return 0;
  const c = boundsCentre(verts);
  let m = 0;
  verts.forEach((v) => (m = Math.max(m, v.distanceTo(c))));
  return m;
}

// Average distance of a vertex set from the origin - used as a stand-in
// for "how big" a shape is, so we can rescale after an operation to
// match the size of whatever shape was displayed before it.
function averageRadius(verts) {
  if (verts.length === 0) return 0;
  let total = 0;
  verts.forEach((v) => (total += v.length()));
  return total / verts.length;
}

function faceMaterial() {
  return new THREE.MeshPhongMaterial({
    color: faceColorHex,
    transparent: settings.transparent,
    opacity: settings.transparent ? 0.55 : 1.0,
    side: THREE.DoubleSide,
    shininess: 40,
  });
}

function clearFaceMeshObjects() {
  faceMeshObjects.forEach((obj) => {
    shapeGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  faceMeshObjects = [];
}

function setFaceGeometry(geometry) {
  clearFaceMeshObjects();
  if (!geometry || geometry.attributes.position.count === 0) return;

  const material = faceMaterial();
  if (geometry.attributes.color) {
    material.vertexColors = true; // per-face colours live in the geometry
    material.color.setHex(0xffffff);
  }
  const mesh = new THREE.Mesh(geometry, material);
  shapeGroup.add(mesh);
  faceMeshObjects.push(mesh);

  const edgesGeo = new THREE.EdgesGeometry(geometry);
  const edges = new THREE.LineSegments(
    edgesGeo,
    new THREE.LineBasicMaterial({ color: 0x9fd3ff }),
  );
  shapeGroup.add(edges);
  faceMeshObjects.push(edges);
}

function reapplyFaceMaterialSettings() {
  faceMeshObjects.forEach((obj) => {
    if (obj.isMesh) {
      obj.material.transparent = settings.transparent;
      obj.material.opacity = settings.transparent ? 0.55 : 1.0;
      obj.material.needsUpdate = true;
    }
  });
}

function rebuildVertexSpheres(verts) {
  vertexColorHex = [];
  globalColorHex = [];
  symmetryPerms = null;
  colorRelative = false;
  vertexSpheres.forEach((s) => {
    shapeGroup.remove(s);
    s.geometry.dispose();
    s.material.dispose();
  });
  vertexSpheres = verts.map((v, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: pointColorHex });
    const sphere = new THREE.Mesh(sphereGeo, mat);
    sphere.position.copy(v);
    sphere.userData.index = i;
    shapeGroup.add(sphere);
    return sphere;
  });
}

function hideAllVertexSpheres() {
  vertexSpheres.forEach((s) => (s.visible = false));
}

function resetSphereColor(idx) {
  vertexSpheres[idx].material.color.setHex(
    vertexColorHex[idx] !== undefined ? vertexColorHex[idx] : pointColorHex,
  );
}

function clearAllSelectionHighlights() {
  selectedIndices.forEach((idx) => resetSphereColor(idx));
  selectedIndices = [];
  if (colorRelative) recolorPoints(); // nothing selected -> back to the overall colouring
}
