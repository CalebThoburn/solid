// ---------------------------------------------------------------
// Coplanarity check (used to restrict which points can join a face
// being built together - a face's points must all lie on one plane)
// ---------------------------------------------------------------
function planeFromThreePoints(a, b, c) {
  const normal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  if (normal.lengthSq() < 1e-8) return null; // collinear - no unique plane yet
  normal.normalize();
  return { normal, point: a };
}

function isCoplanar(plane, point, eps = 1e-3) {
  if (!plane) return true;
  const d = plane.normal.dot(point.clone().sub(plane.point));
  return Math.abs(d) < eps;
}

function updateSelectablePoints() {
  let plane = null;
  if (selectedIndices.length >= 3) {
    plane = planeFromThreePoints(
      currentVerts[selectedIndices[0]],
      currentVerts[selectedIndices[1]],
      currentVerts[selectedIndices[2]],
    );
  }
  vertexSpheres.forEach((sphere, idx) => {
    if (selectedIndices.includes(idx)) {
      sphere.visible = true;
      return;
    }
    sphere.visible = plane ? isCoplanar(plane, currentVerts[idx]) : true;
  });
}
