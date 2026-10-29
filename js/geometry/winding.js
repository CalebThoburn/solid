// ---------------------------------------------------------------
// Winding-order normalization. The dual computation's edge-adjacency
// walk assumes every face's vertices are listed in a consistent
// rotational direction (all "outward", or all "inward") - if some
// faces were clicked in the opposite order from their neighbors,
// shared edges won't line up correctly and the walk misfires. Since
// every shape here is centered on the origin (including star
// polyhedra like the great dodecahedron), a face's outward direction
// can be checked by comparing its own normal (via Newell's method,
// which works for any planar polygon) against the direction from the
// origin to that face's centroid - this reorders/reverses faces as
// needed so every face is consistently wound before it's used.
// ---------------------------------------------------------------
function newellNormal(poly, vertices) {
  const normal = new THREE.Vector3(0, 0, 0);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = vertices[poly[i]];
    const nxt = vertices[poly[(i + 1) % n]];
    normal.x += (cur.y - nxt.y) * (cur.z + nxt.z);
    normal.y += (cur.z - nxt.z) * (cur.x + nxt.x);
    normal.z += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  return normal;
}

// Makes every face wind the same way as its neighbours by walking across
// shared edges (a neighbour that walks a shared edge in the SAME
// direction gets reversed), then picks the overall direction so faces
// point outward. This only uses which faces touch which, not where the
// shape sits relative to the origin, so it works for lopsided or
// off-centre shapes (e.g. ones with the origin on an edge or face).
function normalizeFaceWinding(vertices, facePolygons) {
  const faces = facePolygons.map((f) => f.slice());
  const edgeUsers = new Map();
  faces.forEach((poly, fi) => {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const key = a < b ? a + "_" + b : b + "_" + a;
      if (!edgeUsers.has(key)) edgeUsers.set(key, []);
      edgeUsers.get(key).push(fi);
    });
  });

  function walks(fi, a, b) {
    const poly = faces[fi];
    for (let i = 0; i < poly.length; i++) {
      if (poly[i] === a && poly[(i + 1) % poly.length] === b) return true;
    }
    return false;
  }

  const visited = new Array(faces.length).fill(false);
  for (let s = 0; s < faces.length; s++) {
    if (visited[s]) continue;
    const component = [s];
    const queue = [s];
    visited[s] = true;
    while (queue.length) {
      const fi = queue.shift();
      const poly = faces[fi];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const users = edgeUsers.get(a < b ? a + "_" + b : b + "_" + a);
        if (!users || users.length !== 2) continue;
        const gi = users[0] === fi ? users[1] : users[0];
        if (gi === fi || visited[gi]) continue;
        if (walks(gi, a, b)) faces[gi].reverse();
        visited[gi] = true;
        component.push(gi);
        queue.push(gi);
      }
    }

    // Overall direction: for a closed surface, summing normal . (centre ->
    // face) over all faces gives 3x the signed volume, whichever
    // reference point is used - so use the shape's own vertex centre.
    const used = new Set();
    component.forEach((fi) => faces[fi].forEach((v) => used.add(v)));
    const centre = new THREE.Vector3();
    used.forEach((v) => centre.add(vertices[v]));
    centre.divideScalar(used.size || 1);

    let score = 0;
    component.forEach((fi) => {
      const outward = faceCentroidOf(faces[fi], vertices).sub(centre);
      score += newellNormal(faces[fi], vertices).dot(outward);
    });
    if (score < 0) component.forEach((fi) => faces[fi].reverse());
  }
  return faces;
}

function faceCentroidOf(poly, vertices) {
  const c = new THREE.Vector3();
  poly.forEach((idx) => c.add(vertices[idx]));
  return c.divideScalar(poly.length);
}

// Drops any vertex that isn't referenced by at least one face, and
// remaps face indices to match the shrunk vertex list. Leftover
// vertices like this (e.g. cube corners not used when you reorder its
// hull into a bipyramid) also silently corrupt the average-radius size
// metric used to rescale shapes after each operation, since it's
// averaging in points that aren't actually part of the visible shape -
// pruning them keeps that (and everything downstream, like duals of
// duals) accurate.
function pruneUnusedVertices(vertices, facePolygons) {
  const used = new Set();
  facePolygons.forEach((poly) => poly.forEach((idx) => used.add(idx)));
  const sortedUsed = Array.from(used).sort((a, b) => a - b);
  const oldToNew = new Map();
  sortedUsed.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx, newIdx));

  const newVertices = sortedUsed.map((idx) => vertices[idx].clone());
  const newFaces = facePolygons.map((poly) =>
    poly.map((idx) => oldToNew.get(idx)),
  );
  return { vertices: newVertices, faces: newFaces };
}

// How far any vertex strays from its own face's best-fit plane.
function maxFacePlanarity(vertices, faces) {
  let worst = 0;
  faces.forEach((poly) => {
    const n = newellNormal(poly, vertices);
    if (n.lengthSq() < 1e-18) return;
    n.normalize();
    const c = faceCentroidOf(poly, vertices);
    poly.forEach((k) => {
      worst = Math.max(worst, Math.abs(n.dot(vertices[k].clone().sub(c))));
    });
  });
  return worst;
}

// Re-derives every vertex from the planes of the faces that use it
// (the least-squares point closest to all of them, nudged as little as
// possible where the planes don't pin it down, e.g. a point sitting
// along an edge). Shapes that have been through rounding - an old
// export, or earlier stellations done before values were kept exact -
// have faces that are only almost flat; this pulls them back onto
// consistent planes so the planes of a stellation line up properly.
function planarizeShape(vertices, faces, iterations) {
  iterations = iterations || 12;
  const verts = vertices.map((v) => v.clone());
  const incident = vertices.map(() => []);
  faces.forEach((poly, fi) =>
    new Set(poly).forEach((vi) => incident[vi].push(fi)),
  );
  for (let it = 0; it < iterations; it++) {
    const planes = faces.map((poly) => {
      const n = newellNormal(poly, verts);
      if (n.lengthSq() < 1e-18) return null;
      n.normalize();
      return { n, d: n.dot(faceCentroidOf(poly, verts)) };
    });
    const next = verts.map((v, vi) => {
      const ps = incident[vi].map((fi) => planes[fi]).filter(Boolean);
      if (ps.length < 2) return v;
      const lam = 1e-8;
      const a = [lam, 0, 0, 0, lam, 0, 0, 0, lam];
      const b = [lam * v.x, lam * v.y, lam * v.z];
      ps.forEach(({ n, d }) => {
        a[0] += n.x * n.x;
        a[1] += n.x * n.y;
        a[2] += n.x * n.z;
        a[3] += n.y * n.x;
        a[4] += n.y * n.y;
        a[5] += n.y * n.z;
        a[6] += n.z * n.x;
        a[7] += n.z * n.y;
        a[8] += n.z * n.z;
        b[0] += n.x * d;
        b[1] += n.y * d;
        b[2] += n.z * d;
      });
      const det =
        a[0] * (a[4] * a[8] - a[5] * a[7]) -
        a[1] * (a[3] * a[8] - a[5] * a[6]) +
        a[2] * (a[3] * a[7] - a[4] * a[6]);
      if (Math.abs(det) < 1e-30) return v;
      const x =
        (b[0] * (a[4] * a[8] - a[5] * a[7]) -
          a[1] * (b[1] * a[8] - a[5] * b[2]) +
          a[2] * (b[1] * a[7] - a[4] * b[2])) /
        det;
      const y =
        (a[0] * (b[1] * a[8] - a[5] * b[2]) -
          b[0] * (a[3] * a[8] - a[5] * a[6]) +
          a[2] * (a[3] * b[2] - b[1] * a[6])) /
        det;
      const z =
        (a[0] * (a[4] * b[2] - b[1] * a[7]) -
          a[1] * (a[3] * b[2] - b[1] * a[6]) +
          b[0] * (a[3] * a[7] - a[4] * a[6])) /
        det;
      return new THREE.Vector3(x, y, z);
    });
    for (let i = 0; i < verts.length; i++) verts[i] = next[i];
  }
  return verts;
}

// Only clean up shapes whose faces are already nearly flat (rounding
// noise). A face that is genuinely non-planar - e.g. a truncated
// irregular corner - must be left alone, not bent flat.
function cleanedVertices(vertices, faces) {
  const size = shapeSize(vertices);
  const noise = maxFacePlanarity(vertices, faces);
  if (noise < 1e-12 || noise > size * 2e-3) return vertices;
  return planarizeShape(vertices, faces, 12);
}
