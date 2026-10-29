// ---------------------------------------------------------------
// Import / export the current polyhedron as a text string
// ---------------------------------------------------------------
// Matches each triangle corner of a (possibly rescaled) geometry to the
// nearest vertex in `verts`, so tiny rounding differences can't drop faces.
function facesFromRawGeometry(geometry, verts) {
  const pos = geometry.attributes.position;
  const p = new THREE.Vector3();
  function nearest(j) {
    p.set(pos.getX(j), pos.getY(j), pos.getZ(j));
    let best = -1;
    let bestD = Infinity;
    verts.forEach((v, i) => {
      const d = v.distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < 1e-2 ? best : undefined;
  }
  // BoxGeometry (the cube) is indexed: its triangles are listed in
  // geometry.index, not as consecutive position triples like the others.
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const corner = (k) => (index ? index.getX(k) : k);
  const faces = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const tri = [
      nearest(corner(i)),
      nearest(corner(i + 1)),
      nearest(corner(i + 2)),
    ];
    if (tri.every((idx) => idx !== undefined)) faces.push(tri);
  }
  return faces;
}

function getExportData() {
  let faces;
  if (currentFacePolygons) {
    faces = currentFacePolygons;
  } else if (currentSolidName) {
    const geometry = SOLID_GEOMETRIES[currentSolidName]();
    geometry.scale(currentSolidScale, currentSolidScale, currentSolidScale);
    faces = facesFromRawGeometry(geometry, currentVerts);
  } else {
    faces = [];
  }
  return {
    vertices: currentVerts.map((v) => [
      +v.x.toPrecision(14),
      +v.y.toPrecision(14),
      +v.z.toPrecision(14),
    ]),
    faces,
    ...(currentFacePolygons && faceColors.some((c) => c)
      ? { colors: faceColors }
      : {}),
  };
}

// The shape described by exported text (see getExportData). Throws
// if the data isn't a polyhedron.
function shapeFromData(data) {
  if (!data || !Array.isArray(data.vertices) || !Array.isArray(data.faces)) {
    throw new Error("Expected an object with 'vertices' and 'faces' arrays");
  }
  const verts = data.vertices.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const wound = normalizeFaceWinding(verts, data.faces);
  const pruned = pruneUnusedVertices(verts, wound);
  return {
    verts: pruned.vertices,
    facePolygons: pruned.faces,
    solidName: null,
    solidScale: 1,
    faceColors: pruned.faces.map((_, i) => {
      const c = Array.isArray(data.colors) ? data.colors[i] : null;
      return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
    }),
    dualCentre: null,
  };
}
