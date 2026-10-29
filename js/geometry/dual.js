// ---------------------------------------------------------------
// Dual polyhedron computation (general, for any custom polyhedron -
// including non-convex/star polyhedra such as the great dodecahedron).
//
// Dual vertices = face centroids.
// Dual faces = for each original vertex, the centroids of its
// surrounding faces, in the cyclic order those faces actually meet
// around that vertex. That cyclic order MUST be derived from shared
// edges (topology), not from sorting by angle - angle-sorting only
// gives the right answer for convex shapes. For a star polyhedron
// like the great dodecahedron, walking by shared edges is what
// produces the correct pentagram face order of its dual (the small
// stellated dodecahedron) instead of a plain convex pentagon.
// ---------------------------------------------------------------
function computeDualPolyhedron(vertices, rawFacePolygons, preferredCentre) {
  // The edge walk below needs every face wound consistently, so fix the
  // INPUT first (not just the output) - hand-built faces are often mixed.
  const facePolygons = normalizeFaceWinding(vertices, rawFacePolygons);
  const faceCentroids = facePolygons.map((f) => {
    const c = new THREE.Vector3();
    f.forEach((idx) => c.add(vertices[idx]));
    c.divideScalar(f.length);
    return c;
  });

  // directed edge "a_b" -> the face that has consecutive vertices a,b
  // (in that order) somewhere in its polygon
  const edgeMap = new Map();
  facePolygons.forEach((poly, fi) => {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      edgeMap.set(a + "_" + b, fi);
    }
  });

  // for each vertex, every face touching it, with that face's
  // neighboring vertices (prev/next) around this vertex
  const vertexFaceEntries = vertices.map(() => []);
  facePolygons.forEach((poly, fi) => {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const v = poly[i];
      const prev = poly[(i - 1 + n) % n];
      const next = poly[(i + 1) % n];
      vertexFaceEntries[v].push({ face: fi, prev, next });
    }
  });

  const dualFaces = [];
  vertices.forEach((v, vi) => {
    const entries = vertexFaceEntries[vi];
    if (entries.length < 3) return;

    const entryByFace = new Map();
    entries.forEach((e) => entryByFace.set(e.face, e));

    // Walk the fan of faces around vi by hopping across shared edges:
    // from a face, cross the edge (prev -> vi) to reach the face on
    // the other side, which is the one holding directed edge (vi -> prev).
    const startFace = entries[0].face;
    const order = [];
    let currentFace = startFace;
    let guard = 0;
    do {
      order.push(currentFace);
      const entry = entryByFace.get(currentFace);
      const nextFace = edgeMap.get(vi + "_" + entry.prev);
      if (nextFace === undefined || nextFace === currentFace) break;
      currentFace = nextFace;
      guard++;
    } while (currentFace !== startFace && guard < entries.length + 2);

    if (order.length >= 3 && order.length === entries.length) {
      dualFaces.push(order);
    }
  });

  // Dual vertex positions by polar reciprocation about a centre point: a
  // face plane at distance d with outward unit normal n becomes the point
  // centre + n * r^2 / d. Unlike face centroids this reflects lopsided
  // proportions (differently sized pyramids give differently sized dual
  // faces) and taking the dual twice about the same centre returns the
  // original shape. The centre must lie strictly inside every face plane.
  const usedIdx = new Set();
  facePolygons.forEach((poly) => poly.forEach((v) => usedIdx.add(v)));
  const usedVerts = Array.from(usedIdx).map((v) => vertices[v]);
  const mean = new THREE.Vector3();
  usedVerts.forEach((v) => mean.add(v));
  mean.divideScalar(usedVerts.length || 1);

  function polar(centre) {
    let scale = 0;
    usedVerts.forEach((v) => (scale += v.distanceTo(centre)));
    scale /= usedVerts.length || 1;
    const points = [];
    for (const poly of facePolygons) {
      const normal = newellNormal(poly, vertices);
      if (normal.lengthSq() < 1e-12) return null;
      normal.normalize();
      const d = normal.dot(faceCentroidOf(poly, vertices).sub(centre));
      if (d < 1e-3 * scale) return null;
      points.push(centre.clone().addScaledVector(normal, (scale * scale) / d));
    }
    return points;
  }

  const candidates = [];
  if (preferredCentre) candidates.push(preferredCentre);
  candidates.push(mean, boundsCentre(usedVerts));
  for (const c of candidates) {
    const points = polar(c);
    if (points) {
      return {
        vertices: points,
        faces: normalizeFaceWinding(points, dualFaces),
        centre: c.clone(),
      };
    }
  }
  // No interior point works (very unusual) - fall back to face centroids.
  return {
    vertices: faceCentroids,
    faces: normalizeFaceWinding(faceCentroids, dualFaces),
    centre: mean.clone(),
  };
}
