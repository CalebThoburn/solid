// ---------------------------------------------------------------
// Fast re-stellation of related shapes.
//
// Truncating a shape deeper or shallower never turns its faces: each
// face plane keeps its direction and only slides (original faces stay
// put, corner cuts move in and out). Every corner of a stellation is
// where three face planes meet, so while the stellation keeps the same
// structure - the same three planes meeting at each corner - its new
// corners are just those planes' new meeting points: a 3x3 solve each,
// instead of rebuilding every face's stellation diagram.
//
// The structure only changes when some plane sweeps through one of the
// corners that matter (those of the cells used, and of the cells next
// to them, since those decide how far each face grows). So alongside
// the result, a record keeps every such corner and which side of every
// plane it lies on. On a new shape with the same faces, each corner is
// recomputed and those sides checked: all unchanged means the recorded
// structure still holds exactly; any flip means a full rebuild, whose
// result is then recorded for the next stretch.
// ---------------------------------------------------------------
const stellRecords = new Map(); // shape structure + action -> [record, ...]
const STELL_RECORDS_PER_KEY = 12;
const STELL_RECORD_KEYS = 40;
// While previewing (dragging a slider), a stellation that needs a full
// rebuild is put off rather than run: it returns STELL_PENDING instead.
let stellFastOnly = false;
const STELL_PENDING = { pending: true };

function stellRecordKey(faces, action) {
  return (
    JSON.stringify(action.grows) +
    "|" +
    faces.map((f) => f.join(",")).join(";")
  );
}

// Each face's plane, worked out exactly as the stellation map does.
function stellFacePlanes(vertices, faces) {
  return normalizeFaceWinding(vertices, faces).map((poly) => {
    const n = newellNormal(poly, vertices);
    if (n.lengthSq() < 1e-18) return null;
    n.normalize();
    return { n, d: n.dot(faceCentroidOf(poly, vertices)) };
  });
}

function stellSolve3(p, q, r) {
  const a = p.n,
    b = q.n,
    c = r.n;
  const bc = b.clone().cross(c);
  const det = a.dot(bc);
  if (Math.abs(det) < 1e-9) return null;
  return bc
    .multiplyScalar(p.d)
    .add(c.clone().cross(a).multiplyScalar(q.d))
    .add(a.clone().cross(b).multiplyScalar(r.d))
    .divideScalar(det);
}

// The three of `through` (planes meeting at a point) that pin it down
// best: the first, the one most across it, then the one most across both.
function stellBestTriple(through, planes) {
  if (through.length < 3) return null;
  const a = through[0];
  let b = -1,
    best = 0;
  through.forEach((k) => {
    const s = planes[a].n.clone().cross(planes[k].n).length();
    if (s > best) {
      best = s;
      b = k;
    }
  });
  if (b < 0 || best < 1e-6) return null;
  const ab = planes[a].n.clone().cross(planes[b].n);
  let c = -1;
  best = 0;
  through.forEach((k) => {
    const s = Math.abs(ab.dot(planes[k].n));
    if (s > best) {
      best = s;
      c = k;
    }
  });
  if (c < 0 || best < 1e-6) return null;
  return [a, b, c];
}

function stellPlanesThrough(p, planes, tol) {
  const through = [];
  planes.forEach((pl, k) => {
    if (pl && Math.abs(pl.n.dot(p) - pl.d) < tol) through.push(k);
  });
  return through;
}

function stellShapeSize(vertices) {
  let size = 0;
  vertices.forEach((v) => (size = Math.max(size, v.length())));
  return size;
}

// Records a finished stellation: each result corner as three planes,
// plus the corners to check (see top) with the side of every plane
// each lies on. Returns null if some corner can't be pinned to planes.
function stellMakeRecord(regions, planes, size, result) {
  const tol = size * 2e-4;
  const corners = [];
  for (const v of result.vertices) {
    const triple = stellBestTriple(stellPlanesThrough(v, planes, tol), planes);
    if (!triple) return null;
    corners.push(triple);
  }

  const relevant = new Set();
  regions.forEach((r) => {
    if (!r.on) return;
    relevant.add(r);
    r.neighbors.forEach((n) => relevant.add(n));
  });
  const checks = [];
  const seen = new Set();
  relevant.forEach((r) => {
    r.poly2D.forEach((q) => {
      const p = stellTo3D(q, r.plane);
      const key =
        Math.round(p.x / tol) + "," + Math.round(p.y / tol) + "," + Math.round(p.z / tol);
      if (seen.has(key)) return;
      seen.add(key);
      const through = stellPlanesThrough(p, planes, tol);
      const triple = stellBestTriple(through, planes);
      if (!triple) return; // a corner of the bounding square, not of the shape
      const sides = new Int8Array(planes.length);
      planes.forEach((pl, k) => {
        if (pl) sides[k] = through.includes(k) ? 0 : Math.sign(pl.n.dot(p) - pl.d);
      });
      checks.push({ triple, sides });
    });
  });

  return {
    planeCount: planes.length,
    corners,
    faces: result.faces.map((f) => f.slice()),
    colors: result.colors.slice(),
    checks,
  };
}

// The record's stellation for these planes, or null if its structure
// no longer holds for them.
function stellFromRecord(record, planes, size) {
  if (record.planeCount !== planes.length || planes.some((p) => !p)) return null;
  const tol = size * 2e-4;
  for (const { triple, sides } of record.checks) {
    const p = stellSolve3(planes[triple[0]], planes[triple[1]], planes[triple[2]]);
    if (!p) return null;
    for (let k = 0; k < planes.length; k++) {
      const dist = planes[k].n.dot(p) - planes[k].d;
      if (sides[k] === 0) {
        if (Math.abs(dist) >= tol) return null;
      } else if (Math.sign(dist) !== sides[k] || Math.abs(dist) <= tol) {
        return null;
      }
    }
  }
  const vertices = [];
  for (const [a, b, c] of record.corners) {
    const p = stellSolve3(planes[a], planes[b], planes[c]);
    if (!p) return null;
    vertices.push(p);
  }
  return {
    vertices,
    faces: record.faces.map((f) => f.slice()),
    colors: record.colors,
  };
}

function stellRemember(key, record) {
  let list = stellRecords.get(key);
  if (!list) {
    if (stellRecords.size >= STELL_RECORD_KEYS)
      stellRecords.delete(stellRecords.keys().next().value);
    list = [];
    stellRecords.set(key, list);
  }
  list.unshift(record);
  if (list.length > STELL_RECORDS_PER_KEY) list.pop();
}

// The "stellate" action (see actions.js): grows the listed faces (or
// all of them) by one shell. Uses a recorded structure when one still
// holds; otherwise builds the stellation map and records the result.
function stellateShape(shape, action) {
  const poly = polygonShapeOf(shape);
  if (!poly || poly.faces.length === 0) return null;
  const verts = cleanedVertices(poly.verts, poly.faces);
  const planes = stellFacePlanes(verts, poly.faces);
  const size = stellShapeSize(verts);
  const key = stellRecordKey(poly.faces, action);
  const originalColors = shape.facePolygons ? shape.faceColors : null;
  // Colours are recorded as which face they come from ("new" = grown),
  // so a record can be reused whatever colours the faces have now.
  const colorOf = (token) =>
    token === "new"
      ? action.color
      : token === null
        ? null
        : (originalColors && originalColors[token.face]) || null;

  const list = stellRecords.get(key) || [];
  for (const record of list) {
    const fast = stellFromRecord(record, planes, size);
    if (fast) {
      // most recently useful first
      list.splice(list.indexOf(record), 1);
      list.unshift(record);
      return customShape(
        shape,
        fast.vertices,
        fast.faces,
        null,
        fast.colors.map(colorOf),
      );
    }
  }
  if (stellFastOnly) return STELL_PENDING;

  const regions = computeStellationRegions(verts, poly.faces);
  if (regions.length === 0) return null;
  startStellationSession(regions);
  const mergeGroups = [];
  if (action.grows === "all") {
    if (!stellGrowAllFaces(regions, mergeGroups)) return null;
  } else {
    for (const face of action.grows) {
      if (!stellGrowFace(regions, mergeGroups, face)) return null;
    }
  }
  const result = stellSessionResult(
    regions,
    mergeGroups,
    poly.faces.map((_, face) => ({ face })),
    "new",
  );
  if (!result) return null;
  const record = stellMakeRecord(regions, planes, size, result);
  if (record) stellRemember(key, record);
  return customShape(
    shape,
    result.vertices,
    result.faces,
    null,
    result.colors.map(colorOf),
  );
}
