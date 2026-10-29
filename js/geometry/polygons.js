// ---------------------------------------------------------------
// Face-polygon <-> render-geometry helpers
// ---------------------------------------------------------------
function polygonToTriangleVerts(vertices, poly) {
  if (poly.length === 3) {
    return [[vertices[poly[0]], vertices[poly[1]], vertices[poly[2]]]];
  }
  // Fan from the polygon's centroid rather than its first vertex - this
  // renders sensibly for both convex faces and star/self-intersecting
  // faces (e.g. pentagrams), which a first-vertex fan would draw wrong.
  const centroid = new THREE.Vector3();
  poly.forEach((idx) => centroid.add(vertices[idx]));
  centroid.divideScalar(poly.length);

  const triangles = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[poly[i]];
    const b = vertices[poly[(i + 1) % n]];
    triangles.push([centroid, a, b]);
  }
  return triangles;
}

function geometryFromFacePolygons(vertices, facePolygons, colors) {
  const triangles = [];
  const triFace = []; // which polygon face each rendered triangle belongs to
  facePolygons.forEach((poly, fi) => {
    if (poly.length < 3) return;
    polygonToTriangleVerts(vertices, poly).forEach((tri) => {
      triangles.push(tri);
      triFace.push(fi);
    });
  });
  if (triangles.length === 0) return null;
  const positions = new Float32Array(triangles.length * 9);
  let p = 0;
  triangles.forEach(([a, b, c]) => {
    positions[p++] = a.x;
    positions[p++] = a.y;
    positions[p++] = a.z;
    positions[p++] = b.x;
    positions[p++] = b.y;
    positions[p++] = b.z;
    positions[p++] = c.x;
    positions[p++] = c.y;
    positions[p++] = c.z;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (colors && colors.some((c) => c)) {
    const arr = new Float32Array(triangles.length * 9);
    const tmp = new THREE.Color();
    triFace.forEach((fi, ti) => {
      tmp.set(colors[fi] || faceColorHex);
      for (let k = 0; k < 3; k++) {
        arr[ti * 9 + k * 3] = tmp.r;
        arr[ti * 9 + k * 3 + 1] = tmp.g;
        arr[ti * 9 + k * 3 + 2] = tmp.b;
      }
    });
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  }
  geo.userData.triFace = triFace;
  geo.computeVertexNormals();
  return geo;
}

function renderCurrentShape() {
  setFaceGeometry(
    geometryForShape({
      verts: currentVerts,
      facePolygons: currentFacePolygons,
      solidName: currentSolidName,
      solidScale: currentSolidScale,
      faceColors,
    }),
  );
}
