// ---------------------------------------------------------------
// Truncation. Every edge a-b gets two cut points, one a fraction t of the
// way in from each end. Each original face becomes a polygon through its
// cut points (2n corners), and each original vertex becomes a new face
// through the cut points on its edges. At t = 0.5 the two cut points on an
// edge coincide at its midpoint - that is rectification.
// ---------------------------------------------------------------
function isClosedManifold(faces) {
  if (faces.length === 0) return false;
  const seen = new Set();
  for (const poly of faces) {
    for (let i = 0; i < poly.length; i++) {
      const key = poly[i] + "_" + poly[(i + 1) % poly.length];
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  for (const key of seen) {
    const parts = key.split("_");
    if (!seen.has(parts[1] + "_" + parts[0])) return false;
  }
  return true;
}

function directedEdgeMap(faces) {
  const map = new Map();
  faces.forEach((poly, fi) => {
    poly.forEach((a, i) => map.set(a + "_" + poly[(i + 1) % poly.length], fi));
  });
  return map;
}

// Neighbours of vertex v in cyclic order around it (found by hopping
// across shared edges, so star vertex figures work too). null if the
// faces around v don't close up into a ring.
function vertexRing(v, faces, edgeMap) {
  const entries = [];
  faces.forEach((poly, fi) => {
    const n = poly.length;
    poly.forEach((u, i) => {
      if (u === v) entries.push({ face: fi, prev: poly[(i - 1 + n) % n] });
    });
  });
  if (entries.length === 0) return [];
  const byFace = new Map(entries.map((e) => [e.face, e]));
  const seen = new Set();
  const ring = [];
  let cur = entries[0];
  while (cur && !seen.has(cur.face)) {
    seen.add(cur.face);
    ring.push(cur.prev);
    const g = edgeMap.get(v + "_" + cur.prev);
    cur = g === undefined ? null : byFace.get(g);
  }
  return cur === entries[0] && ring.length === entries.length ? ring : null;
}

function truncatePolyhedron(vertices, rawFaces, t) {
  const faces = normalizeFaceWinding(vertices, rawFaces);
  if (!isClosedManifold(faces)) {
    return {
      error:
        "needs a closed shape where every edge is shared by exactly two faces",
    };
  }
  const edgeMap = directedEdgeMap(faces);
  const rectified = t >= 0.5 - 1e-9;
  const frac = rectified ? 0.5 : t;

  const points = [];
  const pointEdge = []; // the edge each point sits on, and which corners' cuts it belongs to
  const index = new Map();
  function cut(a, b) {
    const key = rectified ? (a < b ? a + "_" + b : b + "_" + a) : a + ">" + b;
    if (index.has(key)) return index.get(key);
    const pa = vertices[a];
    const pb = vertices[b];
    const idx = points.length;
    points.push(pa.clone().add(pb.clone().sub(pa).multiplyScalar(frac)));
    pointEdge.push({ a, b, corners: rectified ? [a, b] : [a] });
    index.set(key, idx);
    return idx;
  }

  const newFaces = [];
  const origin = []; // original face index each new face came from (-1 = new corner face)
  faces.forEach((poly, fi) => {
    const n = poly.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      out.push(cut(a, b), cut(b, a));
    }
    const clean = out.filter(
      (idx, i) => idx !== out[(i - 1 + out.length) % out.length],
    );
    if (clean.length >= 3) {
      newFaces.push(clean);
      origin.push(fi);
    }
  });

  const cornerFaces = new Map();
  for (let v = 0; v < vertices.length; v++) {
    const ring = vertexRing(v, faces, edgeMap);
    if (ring === null)
      return {
        error: "the faces around one of the corners don't form a closed ring",
      };
    if (ring.length >= 3) {
      const face = ring.map((u) => cut(v, u));
      newFaces.push(face);
      origin.push(-1);
      cornerFaces.set(v, face);
    }
  }
  flattenCornerCuts(vertices, points, pointEdge, cornerFaces, rectified);

  return {
    vertices: points,
    faces: normalizeFaceWinding(points, newFaces),
    origin,
  };
}

// Cutting every edge at the same fraction only gives flat new corner
// faces when each corner's neighbours are evenly placed around it (as
// on the regular and uniform solids). Elsewhere - e.g. a corner of a
// triakis icosahedron, whose 10 neighbours alternate between two
// distances - the cut points don't lie in one plane, and a bent face
// breaks anything that needs a face's plane (stellation, the dual). So
// each corner is cut by a plane instead: fit one through its cut
// points, then slide each point along its own edge onto that plane.
// Points stay on the original edges, so the original faces keep their
// exact planes. For truncation one pass is exact; for rectification
// each point is shared by the cuts at both ends of its edge, so the
// two are balanced over repeated passes until they agree.
function flattenCornerCuts(vertices, points, pointEdge, cornerFaces, rectified) {
  let size = 0;
  vertices.forEach((v) => (size = Math.max(size, v.length())));
  const tol = Math.max(size * 1e-12, 1e-14);
  const passes = rectified ? 500 : 1;
  for (let pass = 0; pass < passes; pass++) {
    if (maxFacePlanarity(points, Array.from(cornerFaces.values())) < tol)
      return;
    const planes = new Map();
    cornerFaces.forEach((face, v) => {
      const n = newellNormal(face, points);
      if (n.lengthSq() < 1e-18) return;
      n.normalize();
      planes.set(v, { n, d: n.dot(faceCentroidOf(face, points)) });
    });
    pointEdge.forEach(({ a, b, corners }, i) => {
      const start = vertices[a];
      const dir = vertices[b].clone().sub(start);
      // where along the edge (0 = a, 1 = b) best meets the corner planes
      let num = 0,
        den = 0;
      corners.forEach((v) => {
        const pl = planes.get(v);
        if (!pl) return;
        const along = pl.n.dot(dir);
        num += (pl.d - pl.n.dot(start)) * along;
        den += along * along;
      });
      if (den < 1e-18) return;
      const s = Math.min(Math.max(num / den, 0.001), 0.999);
      points[i] = start.clone().addScaledVector(dir, s);
    });
  }
}

// The named solids only carry triangles; merge coplanar triangles back
// into their true polygon faces (a cube's 12 triangles -> 6 squares).
function mergeCoplanarTriangles(verts, triangles) {
  const groups = [];
  triangles.forEach((tri) => {
    const [a, b, c] = tri.map((i) => verts[i]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    const o = n.dot(a);
    let g = groups.find(
      (q) => q.n.dot(n) > 1 - 1e-5 && Math.abs(q.o - o) < 1e-3,
    );
    if (!g) {
      g = { n, o, tris: [] };
      groups.push(g);
    }
    g.tris.push(tri);
  });

  const faces = [];
  groups.forEach((g) => {
    const dir = new Set();
    g.tris.forEach(([a, b, c]) => {
      dir.add(a + "_" + b);
      dir.add(b + "_" + c);
      dir.add(c + "_" + a);
    });
    const next = new Map();
    dir.forEach((key) => {
      const [a, b] = key.split("_").map(Number);
      if (!dir.has(b + "_" + a)) next.set(a, b);
    });
    if (next.size === 0) return;
    const start = next.keys().next().value;
    const poly = [start];
    let cur = next.get(start);
    let guard = 0;
    while (cur !== undefined && cur !== start && guard++ < 1000) {
      poly.push(cur);
      cur = next.get(cur);
    }
    if (poly.length >= 3) faces.push(poly);
  });
  return faces;
}

// Vertices + polygon faces of whatever is currently shown.
function currentPolygonShape() {
  return polygonShapeOf({
    verts: currentVerts,
    facePolygons: currentFacePolygons,
    solidName: currentSolidName,
    solidScale: currentSolidScale,
  });
}

// Centre + rescale vertices the same way a dual is fitted, so a shape
// that shrinks (as truncation does) keeps the previous shape's size.
function fitToCurrentSize(newVerts) {
  const prevSize = currentVerts.length > 0 ? shapeSize(currentVerts) : null;
  const newSize = shapeSize(newVerts);
  const scale = prevSize !== null && newSize > 1e-6 ? prevSize / newSize : 1;
  const shift = boundsCentre(newVerts);
  return newVerts.map((v) => v.clone().sub(shift).multiplyScalar(scale));
}
