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
  if (!fanDrawsPolygon(vertices, poly, centroid))
    return windingTriangles(vertices, poly);

  const triangles = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[poly[i]];
    const b = vertices[poly[(i + 1) % n]];
    triangles.push([centroid, a, b]);
  }
  return triangles;
}

// A fan from the centre draws the polygon exactly when every edge turns
// the same way around that centre (convex faces, pentagrams, {8/3}).
// Faces that double back on themselves - an antitruncated square, whose
// edges run on past each corner and come back across it - don't, and a
// fan would fill in wedges that aren't part of the face.
function fanDrawsPolygon(vertices, poly, centroid) {
  const n = newellNormal(poly, vertices);
  if (n.lengthSq() < 1e-18) return true;
  let size = 0;
  poly.forEach((i) => (size = Math.max(size, vertices[i].distanceTo(centroid))));
  const tol = size * size * 1e-9;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = vertices[poly[i]].clone().sub(centroid);
    const b = vertices[poly[(i + 1) % poly.length]].clone().sub(centroid);
    const turn = a.cross(b).dot(n);
    if (Math.abs(turn) < tol) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

// Fills exactly the points the polygon winds around (nonzero rule), so a
// self-crossing face shows just what it covers. Works in the face's own
// plane: cut it into vertical slabs at every corner and crossing, where
// the edges running through a slab don't cross, and fill the gaps
// between consecutive edges that are wound around.
function windingTriangles(vertices, poly) {
  const normal = newellNormal(poly, vertices).normalize();
  const origin = faceCentroidOf(poly, vertices);
  let t = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(t)) > 0.9) t = new THREE.Vector3(0, 1, 0);
  const u = t.addScaledVector(normal, -t.dot(normal)).normalize();
  const v = normal.clone().cross(u);
  const pts = poly.map((i) => {
    const rel = vertices[i].clone().sub(origin);
    return { x: rel.dot(u), y: rel.dot(v) };
  });
  const to3D = (x, y) =>
    origin.clone().addScaledVector(u, x).addScaledVector(v, y);

  let size = 0;
  pts.forEach((q) => (size = Math.max(size, Math.abs(q.x), Math.abs(q.y))));
  const eps = Math.max(size * 1e-9, 1e-12);
  const segs = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    if (Math.abs(a.x - b.x) > eps) segs.push({ a, b });
  });

  const xs = pts.map((q) => q.x);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i].a,
        r = { x: segs[i].b.x - p.x, y: segs[i].b.y - p.y };
      const q = segs[j].a,
        s = { x: segs[j].b.x - q.x, y: segs[j].b.y - q.y };
      const den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < 1e-18) continue;
      const tt = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
      const uu = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
      if (tt > 0 && tt < 1 && uu > 0 && uu < 1) xs.push(p.x + tt * r.x);
    }
  }
  xs.sort((a, b) => a - b);

  const yAt = (sg, x) =>
    sg.a.y + ((x - sg.a.x) / (sg.b.x - sg.a.x)) * (sg.b.y - sg.a.y);
  const triangles = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const x0 = xs[k],
      x1 = xs[k + 1];
    if (x1 - x0 < eps) continue;
    const xm = (x0 + x1) / 2;
    const crossing = segs
      .filter(
        (sg) => Math.min(sg.a.x, sg.b.x) < xm && Math.max(sg.a.x, sg.b.x) > xm,
      )
      .map((sg) => ({
        y0: yAt(sg, x0),
        y1: yAt(sg, x1),
        ym: yAt(sg, xm),
        dir: sg.b.x > sg.a.x ? 1 : -1,
      }))
      .sort((p, q) => p.ym - q.ym);
    let winding = 0;
    for (let i = 0; i + 1 < crossing.length; i++) {
      winding += crossing[i].dir;
      if (winding === 0) continue;
      const lo = crossing[i],
        hi = crossing[i + 1];
      const a = to3D(x0, lo.y0),
        b = to3D(x1, lo.y1),
        c = to3D(x1, hi.y1),
        d = to3D(x0, hi.y0);
      if (hi.y1 - lo.y1 > eps) triangles.push([a, b, c]);
      if (hi.y0 - lo.y0 > eps) triangles.push([a, c, d]);
    }
  }
  return triangles;
}

// Lines for a face geometry's edges: the faces' own sides when it was
// built from polygons (so a face filled in pieces doesn't show the
// seams between them), otherwise the creases between its triangles.
function faceEdgeLines(geometry) {
  const outline = geometry.userData.outline;
  if (!outline) return new THREE.EdgesGeometry(geometry);
  const positions = new Float32Array(outline.length * 3);
  outline.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
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
  // each side once, even where two faces share it
  const outline = [];
  const drawn = new Set();
  facePolygons.forEach((poly) => {
    if (poly.length < 3) return;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const key = a < b ? a + "_" + b : b + "_" + a;
      if (drawn.has(key)) return;
      drawn.add(key);
      outline.push(vertices[a], vertices[b]);
    });
  });
  geo.userData.outline = outline;
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
