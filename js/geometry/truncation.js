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

// The corners next to v, in order around it, or null if the faces at v
// don't form a single ring. Each face meeting at v links the two corners
// on either side of v in that face; following the links goes round v.
// This doesn't rely on faces being wound consistently, so it works on
// one-sided shapes too - e.g. hemipolyhedra such as the great
// dodecahemicosahedron, whose hexagons pass through the centre.
function cornerRing(v, faces) {
  const links = [];
  faces.forEach((poly) => {
    const n = poly.length;
    poly.forEach((u, i) => {
      if (u === v) links.push([poly[(i - 1 + n) % n], poly[(i + 1) % n]]);
    });
  });
  if (links.length === 0) return [];
  const linksAt = new Map();
  links.forEach((link, li) =>
    link.forEach((u) => {
      if (!linksAt.has(u)) linksAt.set(u, []);
      linksAt.get(u).push(li);
    }),
  );
  for (const list of linksAt.values()) if (list.length !== 2) return null;
  const ring = [];
  const used = new Set();
  let li = 0;
  let u = links[0][0];
  while (!used.has(li)) {
    used.add(li);
    ring.push(u);
    const [a, b] = links[li];
    u = a === u ? b : a;
    li = linksAt.get(u).find((other) => other !== li);
  }
  return used.size === links.length ? ring : null;
}

// Whether a shape can be truncated as it is: every edge shared by exactly
// two faces, and the faces at every corner forming one ring. (Its faces
// needn't be windable all one way - one-sided shapes are fine.)
function truncatableFaces(vertexCount, faces) {
  if (!facesFormClosedSurface(faces)) return false;
  for (let v = 0; v < vertexCount; v++) if (cornerRing(v, faces) === null) return false;
  return true;
}

function truncatePolyhedron(vertices, rawFaces, t) {
  const faces = normalizeFaceWinding(vertices, rawFaces);
  if (!facesFormClosedSurface(faces)) {
    return {
      error:
        "needs a closed shape where every edge is shared by exactly two faces",
    };
  }
  // t is how far along each edge (as a fraction of it) the cut lands,
  // from each end: 0..0.5 truncates, 0.5 rectifies, 0.5..1 hypertruncates
  // (the cuts from the two ends cross over), past 1 quasitruncates, and
  // below 0 antitruncates (the cut lands outside, past the corner).
  const rectified = Math.abs(t - 0.5) < 1e-9;
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
    const ring = cornerRing(v, faces);
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
      let n = newellNormal(face, points);
      // A corner face can cross itself so that its halves cancel out
      // (a bow tie, at the corners of a hemipolyhedron); then its
      // diagonals still span its plane.
      if (n.lengthSq() < 1e-12 * size * size * size * size && face.length >= 4) {
        const half = face.length >> 1;
        n = points[face[half]]
          .clone()
          .sub(points[face[0]])
          .cross(points[face[(half + 1) % face.length]].clone().sub(points[face[1]]));
      }
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
      // a shared rectification point has to stay inside its edge
      const s = rectified
        ? Math.min(Math.max(num / den, 0.001), 0.999)
        : num / den;
      points[i] = start.clone().addScaledVector(dir, s);
    });
  }
}

// The cut depths that make every edge of the result the same length:
// { truncate } (between 0 and 0.5; a cube's is 1/(2+sqrt2), giving
// regular octagons) and { quasi } (past 1; a cube's is 1 + 1/sqrt2, giving
// regular {8/3} octagrams). Each edge leaves a middle piece |1 - 2t|
// times as long as itself, and each corner face gets edges t times as
// long as the gap between two neighbouring corners - the depth where the
// two kinds average out equal is exact on regular solids and the closest
// fit on others. Null if the shape can't be truncated.
function uniformTruncationDepths(vertices, rawFaces) {
  const faces = normalizeFaceWinding(vertices, rawFaces);
  if (!facesFormClosedSurface(faces)) return null;
  let edgeSum = 0,
    edgeCount = 0,
    gapSum = 0,
    gapCount = 0;
  faces.forEach((poly) =>
    poly.forEach((a, i) => {
      edgeSum += vertices[a].distanceTo(vertices[poly[(i + 1) % poly.length]]);
      edgeCount++;
    }),
  );
  for (let v = 0; v < vertices.length; v++) {
    const ring = cornerRing(v, faces);
    if (!ring || ring.length < 3) continue;
    ring.forEach((u, i) => {
      gapSum += vertices[u].distanceTo(vertices[ring[(i + 1) % ring.length]]);
      gapCount++;
    });
  }
  if (!edgeCount || !gapCount) return null;
  const edge = edgeSum / edgeCount,
    gap = gapSum / gapCount;
  return {
    truncate: edge / (2 * edge + gap),
    quasi: 2 * edge > gap ? edge / (2 * edge - gap) : null,
  };
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
