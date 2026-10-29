// ---------------------------------------------------------------
// Solidify: the outer surface of the solid a set of faces encloses.
//
// Faces that overlap, touch or pass through each other - two shapes
// sharing a face, or a stellation whose faces come down onto another
// face partway across it (like a pyramid standing on a cube's top face,
// with that face still running underneath) - can look like a perfectly
// good solid without forming one clean surface: an edge used by just
// one face, a face partly buried inside. Truncation and the dual need
// the clean surface, so this rebuilds it.
//
// The face planes cut space into convex pockets, each named exactly by
// which side of every plane it is on. Pockets meet across the cells of
// the planes' diagrams (the same diagrams as stellation); a cell no
// face covers is an open doorway between the pockets either side of it.
// Flooding out from the pockets that reach infinity finds all of the
// outside; everything else is the solid. The surface is then the
// covered cells with outside on exactly one side - so hidden parts of
// faces, and overlaps between shapes, drop out. Neighbouring surface
// cells in one plane, facing the same way, join into one face, and
// corners left partway along a straight edge (in every face that has
// them) go.
// ---------------------------------------------------------------

// Removes corners that sit partway along a straight edge in every face
// that uses them (leftovers of cutting edges at every plane crossing).
function dropStraightCorners(vertices, faces) {
  const straight = (poly, i) => {
    const a = vertices[poly[(i - 1 + poly.length) % poly.length]],
      b = vertices[poly[i]],
      c = vertices[poly[(i + 1) % poly.length]];
    const u = b.clone().sub(a),
      w = c.clone().sub(b);
    const lu = u.length(),
      lw = w.length();
    if (lu === 0 || lw === 0) return true;
    if (u.dot(w) <= 0) return false; // turns back on itself
    return u.cross(w).length() / (lu * lw) < 1e-6; // (cross overwrites u)
  };
  const keep = new Array(vertices.length).fill(false);
  faces.forEach((poly) =>
    poly.forEach((v, i) => {
      if (!straight(poly, i)) keep[v] = true;
    }),
  );
  // one entry per face, in order (a face can come out with < 3 corners)
  return faces.map((poly) => poly.filter((v) => keep[v]));
}

// The outline(s) one group of joined surface cells becomes: the group's
// whole outline when it traces exactly those cells, otherwise (a group
// around a hole) each cell on its own. Unlike stellation's outlines,
// every point along each side is kept, so neighbouring faces' sides
// match point for point; points that turn out to be straight in every
// face are dropped afterwards (dropStraightCorners).
function solidGroupLoops(group, faceCells) {
  if (group.length === 1) return [group[0].poly2D.slice()];
  const loop = mergeFaceCellGroup(group);
  const inGroup = new Set(group);
  const exact =
    loop.length >= 3 &&
    faceCells.every((c) => stellWindingContains(loop, c.mid2D) === inGroup.has(c));
  return exact ? [loop] : group.map((c) => c.poly2D.slice());
}

// The pockets a set of faces divides space into, and which of them the
// solid fills (see the top of this file). Returns null if there's
// nothing to work with, else
//   { regions, byPlane, isInside(pocket), unboundedPockets }
// where each region (a cell of a plane's diagram) has gained
//   front / back   the pockets on either side (front = along the
//                  plane's normal), named by a hash of their side of
//                  every plane
//   cover          the input face covering it, or -1
function analyzeSolid(vertices, faces) {
  if (faces.length === 0) return null;
  let size = 0;
  vertices.forEach((v) => (size = Math.max(size, v.length())));
  const tol = Math.max(size * 1e-6, 1e-9);

  // one diagram per distinct plane, however many faces lie in it
  const facePlanes = faces.map((poly) => {
    const n = newellNormal(poly, vertices);
    if (n.lengthSq() < 1e-18) return null;
    n.normalize();
    return { n, d: n.dot(faceCentroidOf(poly, vertices)) };
  });
  const planeOf = []; // face -> index into reps
  const reps = []; // one face per distinct plane
  faces.forEach((poly, fi) => {
    const p = facePlanes[fi];
    if (!p) return planeOf.push(-1);
    const same = reps.findIndex((ri) => {
      const q = facePlanes[ri];
      const dot = p.n.dot(q.n);
      return Math.abs(Math.abs(dot) - 1) < 1e-9 && Math.abs(p.d - Math.sign(dot) * q.d) < tol * 10;
    });
    if (same >= 0) planeOf.push(same);
    else {
      planeOf.push(reps.length);
      reps.push(fi);
    }
  });
  const regions = computeStellationRegions(
    vertices,
    reps.map((fi) => faces[fi]),
  );
  if (regions.length === 0) return null;

  const byPlane = new Map();
  const planes = []; // per plane: { n, d }, from its cells
  regions.forEach((r) => {
    if (!byPlane.has(r.face)) {
      byPlane.set(r.face, []);
      planes[r.face] = { n: r.plane.normal, d: r.plane.normal.dot(r.plane.centroid) };
    }
    byPlane.get(r.face).push(r);
  });

  // Each input face's outline in its plane's own 2D coordinates, to
  // find which face (if any) covers a cell.
  const outlines = faces.map((poly, fi) => {
    const cells = byPlane.get(planeOf[fi]);
    if (!cells) return null;
    const pl = cells[0].plane;
    return poly.map((i) => {
      const rel = vertices[i].clone().sub(pl.centroid);
      return { x: rel.dot(pl.u), y: rel.dot(pl.v) };
    });
  });
  function coveringFace(r) {
    for (let fi = 0; fi < faces.length; fi++) {
      if (planeOf[fi] === r.face && outlines[fi] && stellWindingContains(outlines[fi], r.mid2D))
        return fi;
    }
    return -1;
  }

  // A pocket's name: two running hashes of its side of every plane (a
  // full list of sides would be huge for big shapes - hundreds of
  // planes for each of hundreds of thousands of cells). The planes are
  // kept in flat arrays: this runs for every cell against every plane.
  const planeIds = [];
  planes.forEach((pl, k) => pl && planeIds.push(k));
  const P = planeIds.length;
  const nx = new Float64Array(P),
    ny = new Float64Array(P),
    nz = new Float64Array(P),
    nd = new Float64Array(P);
  planeIds.forEach((k, j) => {
    nx[j] = planes[k].n.x;
    ny[j] = planes[k].n.y;
    nz[j] = planes[k].n.z;
    nd[j] = planes[k].d;
  });
  const slotOf = new Map(planeIds.map((k, j) => [k, j]));
  const sides = new Uint8Array(P);
  function hashSides(own, ownSide) {
    let h1 = 2166136261,
      h2 = 5381;
    for (let j = 0; j < P; j++) {
      const bit = j === own ? ownSide : sides[j];
      h1 = Math.imul(h1 ^ (bit + 1), 16777619) >>> 0;
      h2 = (Math.imul(h2, 33) + bit + 7 * j) >>> 0;
    }
    return h1.toString(36) + ":" + h2.toString(36);
  }
  // the pockets in front of and behind a cell
  function pocketsBeside(r) {
    const m = stellTo3D(r.mid2D, r.plane);
    for (let j = 0; j < P; j++)
      sides[j] = nx[j] * m.x + ny[j] * m.y + nz[j] * m.z - nd[j] > 0 ? 1 : 0;
    const own = slotOf.get(r.face);
    r.front = hashSides(own, 1);
    r.back = hashSides(own, 0);
  }
  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(k) !== root) {
      const next = parent.get(k);
      parent.set(k, root);
      k = next;
    }
    return root;
  };
  const join = (a, b) => parent.set(find(a), find(b));

  const OUTSIDE = "outside";
  const unboundedPockets = new Set();
  regions.forEach((r) => {
    pocketsBeside(r);
    r.cover = coveringFace(r);
    if (r.cover < 0) join(r.front, r.back); // an open doorway
    if (r.unbounded) {
      // the pockets beside a cell that runs off to infinity reach it too
      unboundedPockets.add(r.front);
      unboundedPockets.add(r.back);
      join(r.front, OUTSIDE);
      join(r.back, OUTSIDE);
    }
  });
  const outside = find(OUTSIDE);
  return {
    regions,
    byPlane,
    isInside: (pocket) => find(pocket) !== outside,
    unboundedPockets,
  };
}

// Joins the cells marked `on` in each plane into faces: neighbouring
// cells for which sameFace(a, b) holds become one face (or several, see
// loopsOf). Returns [{ loop2D, plane, start, group }].
function joinCellsIntoFaces(byPlane, sameFace, loopsOf) {
  const loops = [];
  byPlane.forEach((cells) => {
    const seen = new Set();
    cells.forEach((start) => {
      if (!start.on || seen.has(start)) return;
      const group = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const c = stack.pop();
        group.push(c);
        c.neighbors.forEach((nb) => {
          if (nb.on && !seen.has(nb) && sameFace(start, nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        });
      }
      loopsOf(group, cells).forEach((loop2D) =>
        loops.push({ loop2D, plane: start.plane, start, group }),
      );
    });
  });
  return loops;
}

// The outer surface of the solid `faces` enclose, as
// { vertices, faces, colors } - or null if it can't be worked out.
function solidifyPolyhedron(vertices, faces, colors) {
  const solid = analyzeSolid(vertices, faces);
  if (!solid) return null;
  const { regions, byPlane, isInside } = solid;
  regions.forEach((r) => {
    r.on = false;
    if (r.cover < 0 || r.unbounded) return;
    const frontIn = isInside(r.front),
      backIn = isInside(r.back);
    if (frontIn === backIn) return; // buried inside, or a loose sheet
    r.on = true;
    r.outwardAlongNormal = backIn; // the solid is behind it
  });

  const loops = joinCellsIntoFaces(
    byPlane,
    (a, b) => a.outwardAlongNormal === b.outwardAlongNormal,
    solidGroupLoops,
  ).map(({ loop2D, plane, start }) => ({
    loop2D: start.outwardAlongNormal ? loop2D : loop2D.slice().reverse(),
    plane,
    color: colors ? colors[start.cover] || null : null,
  }));
  if (loops.length === 0) return null;

  const built = buildShapeFromLoops(loops, true);
  const trimmed = dropStraightCorners(built.vertices, built.faces);
  const facesOut = [];
  const colorsOut = [];
  trimmed.forEach((poly, i) => {
    if (poly.length < 3) return;
    facesOut.push(poly);
    colorsOut.push(built.colors[i]);
  });
  if (facesOut.length === 0) return null;
  const pruned = pruneUnusedVertices(built.vertices, facesOut);
  return {
    vertices: pruned.vertices,
    faces: normalizeFaceWinding(pruned.vertices, pruned.faces),
    colors: colorsOut,
  };
}

// ---------------------------------------------------------------
// The next stellation along the main line, by 3D pockets: the solid
// grows by every pocket that shares a side with it (all of them, all
// round - which is what keeps the result one clean solid), and each
// face becomes its plane's old face together with whatever of that
// plane is newly on the surface. So the pentagons of a dodecahedron
// gain the 5 tips around them and become pentagrams: the small
// stellated dodecahedron, not its 60 visible triangles. Returns null if
// it can't stellate (a pocket it would need runs off to infinity, as
// past a great stellated dodecahedron or round a cube). Faces come back
// with colour tokens: { face } for a face that's unchanged, "new" for
// one that grew. `relevant` lists the cells the result depends on (for
// stellation-cache.js).
// ---------------------------------------------------------------
function stellateLayer(vertices, faces) {
  const solid = analyzeSolid(vertices, faces);
  if (!solid) return null;
  const { regions, byPlane, isInside, unboundedPockets } = solid;

  const grown = new Set();
  for (const r of regions) {
    const frontIn = isInside(r.front),
      backIn = isInside(r.back);
    if (frontIn === backIn) continue;
    const beyond = frontIn ? r.back : r.front;
    if (unboundedPockets.has(beyond)) return null; // runs off to infinity
    grown.add(beyond);
  }
  if (grown.size === 0) return null;
  const inNext = (pocket) => grown.has(pocket) || isInside(pocket);

  regions.forEach((r) => {
    r.previous = r.cover >= 0;
    r.surface = !r.unbounded && inNext(r.front) !== inNext(r.back);
    r.on = r.previous || r.surface;
  });

  const loops = joinCellsIntoFaces(byPlane, () => true, stellGroupLoops).map(
    ({ loop2D, plane, group }) => {
      // a face that's still just its old self keeps its colour
      const unchanged = group.every((c) => c.previous) && group.some((c) => c.previous);
      const before = group.find((c) => c.previous);
      return {
        loop2D,
        plane,
        color: unchanged && before ? { face: before.cover } : "new",
      };
    },
  );
  if (loops.length === 0) return null;
  const result = stellFinishShape(buildShapeFromLoops(loops, true));
  if (!result) return null;
  const relevant = regions.filter(
    (r) => r.on || inNext(r.front) || inNext(r.back),
  );
  return { result, regions, relevant };
}

// What truncation works on: the shape itself when it is one clean
// surface (every edge shared by exactly two faces, one ring of faces
// at every corner), otherwise the solid
// it encloses - e.g. a stellation whose faces end partway across other
// faces. { verts, faces, colors, solidified }
function truncationSource(verts, faces, colors) {
  const plain = { verts, faces, colors, solidified: false };
  if (truncatableFaces(verts.length, faces)) return plain;
  const solid = solidifyPolyhedron(verts, faces, colors);
  if (!solid || !truncatableFaces(solid.vertices.length, solid.faces)) return plain;
  return {
    verts: solid.vertices,
    faces: solid.faces,
    colors: solid.colors,
    solidified: true,
  };
}

// Do two polyhedra share any corner?
function polyhedraSharePoint(a, b) {
  let size = 0;
  [...a.verts, ...b.verts].forEach((v) => (size = Math.max(size, v.length())));
  const tol = Math.max(size * 1e-6, 1e-9);
  return a.verts.some((p) => b.verts.some((q) => p.distanceTo(q) < tol));
}
