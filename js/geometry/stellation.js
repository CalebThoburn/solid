// ---------------------------------------------------------------
// Stellation map: extend every face's plane infinitely. Within any
// one face's own plane, every OTHER face's plane crosses it as a
// line; together these lines cut that face's plane into a patchwork
// of convex regions - "cells" - the same "stellation diagram" used
// by stellation software and books. Each face gets its own diagram
// (computed in its own 2D plane coordinates), and all of them, laid
// end to end, are the regions the user cycles through and toggles.
// ---------------------------------------------------------------

// Clip a convex 2D polygon to one side of the line through p1,p2.
function stellSide(p, p1, p2, eps) {
  const s = (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
  return Math.abs(s) < eps ? 0 : s;
}
function stellClip(poly, p1, p2, keepPositive, eps) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i],
      next = poly[(i + 1) % n];
    const curSide = stellSide(cur, p1, p2, eps),
      nextSide = stellSide(next, p1, p2, eps);
    const curIn = keepPositive ? curSide >= 0 : curSide <= 0;
    const nextIn = keepPositive ? nextSide >= 0 : nextSide <= 0;
    if (curIn) out.push(cur);
    if (curIn !== nextIn && curSide !== nextSide) {
      const t = curSide / (curSide - nextSide);
      out.push({
        x: cur.x + t * (next.x - cur.x),
        y: cur.y + t * (next.y - cur.y),
      });
    }
  }
  return out;
}
// Nonzero-winding point-in-polygon test, so a face that is itself a
// star (a pentagram traced as one loop) counts its centre as inside -
// matching how such a face is actually drawn (filled from its centroid).
function stellWindingContains(poly, pt) {
  let wn = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
    if (a.y <= pt.y) {
      if (b.y > pt.y && cross > 0) wn++;
    } else if (b.y <= pt.y && cross < 0) {
      wn--;
    }
  }
  return wn !== 0;
}

// Sutherland-Hodgman clipping can leave an original vertex and an
// almost-identical intersection point sitting right next to each
// other in the output (when a clip line passes almost exactly through
// an existing corner). Left in, these create a zero-length edge from
// a point back to itself, which has no real partner to cancel against
// when merging cells - collapsing them here keeps every cell's own
// points clean before anything downstream (rendering, merging, or
// building the final shape) ever sees them.
function stellDedupePoly(poly, eps) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const prev = out[out.length - 1];
    if (!prev || Math.abs(p.x - prev.x) >= eps || Math.abs(p.y - prev.y) >= eps)
      out.push(p);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0].x - out[out.length - 1].x) < eps &&
    Math.abs(out[0].y - out[out.length - 1].y) < eps
  ) {
    out.pop();
  }
  return out;
}
function stellPolyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
function stellPointInside(poly, p, eps) {
  for (let i = 0; i < poly.length; i++) {
    if (stellSide(p, poly[i], poly[(i + 1) % poly.length], eps) < 0)
      return false;
  }
  return true;
}
// Incrementally slice a big bounding square by every line, keeping
// every resulting piece - this is exactly the arrangement's cells.
function stellBuildCells(boundBox, lines, eps) {
  let cells = [boundBox];
  lines.forEach(([p1, p2]) => {
    const next = [];
    cells.forEach((cell) => {
      const pos = stellClip(cell, p1, p2, true, eps);
      const neg = stellClip(cell, p1, p2, false, eps);
      if (pos.length >= 3 && stellPolyArea(pos) > eps * eps) next.push(pos);
      if (neg.length >= 3 && stellPolyArea(neg) > eps * eps) next.push(neg);
    });
    cells = next;
  });
  return cells;
}

function stellTo3D(p2, plane) {
  return plane.centroid
    .clone()
    .add(plane.u.clone().multiplyScalar(p2.x))
    .add(plane.v.clone().multiplyScalar(p2.y));
}

// Computes every region across every face of the given shape. A real
// stellation only ever replaces a face with a (possibly larger) cell
// from that SAME face's own plane diagram - e.g. a dodecahedron's
// pentagon becomes a pentagram entirely within its own plane, built
// from the 5 small triangular cells bordering it there. There is no
// such thing as "borrowing" a cell from a different face's diagram;
// each face's own diagram is independent, so each region also gets
// its same-face neighbours (cells it shares a 2D edge with, within
// this face's own diagram) precomputed here.
function computeStellationRegions(vertices, rawFacePolygons) {
  const facePolygons = normalizeFaceWinding(vertices, rawFacePolygons);

  let maxR = 0;
  vertices.forEach((v) => (maxR = Math.max(maxR, v.length())));
  // Far enough out that every finite cell fits inside (the great
  // stellated dodecahedron's tips reach well past twice the radius);
  // a cell that still touches the square runs off to infinity.
  const S = Math.max(maxR, 1) * 50;
  const boundBox = [
    { x: -S, y: -S },
    { x: S, y: -S },
    { x: S, y: S },
    { x: -S, y: S },
  ];
  const eps = Math.max(maxR * 1e-6, 1e-9);
  // How far the shape's faces stray from perfectly flat: the corners
  // of near-concurrent planes can only be trusted to about this much.
  const planeNoise = maxFacePlanarity(vertices, facePolygons);

  const planes = facePolygons.map((poly) => {
    const centroid = faceCentroidOf(poly, vertices);
    const normal = newellNormal(poly, vertices);
    if (normal.lengthSq() < 1e-12) return null;
    normal.normalize();
    let t = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(t)) > 0.9) t = new THREE.Vector3(0, 1, 0);
    const u = t
      .clone()
      .sub(normal.clone().multiplyScalar(t.dot(normal)))
      .normalize();
    const v = normal.clone().cross(u);
    return { centroid, normal, u, v };
  });

  function edgesOf(poly) {
    return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
  }
  const regions = [];
  facePolygons.forEach((poly, fi) => {
    const planeF = planes[fi];
    if (!planeF) return;

    const lines = [];
    planes.forEach((planeG, gi) => {
      if (gi === fi || !planeG) return;
      const dir = planeF.normal.clone().cross(planeG.normal);
      if (dir.lengthSq() < 1e-12) return; // parallel planes never meet
      const a = planeG.normal.dot(planeF.u);
      const b = planeG.normal.dot(planeF.v);
      if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) return;
      const c = planeG.normal.dot(planeG.centroid.clone().sub(planeF.centroid));
      const big = S * 10;
      let p1, p2;
      if (Math.abs(b) > Math.abs(a)) {
        p1 = { x: -big, y: (c + big * a) / b };
        p2 = { x: big, y: (c - big * a) / b };
      } else {
        p1 = { x: (c + big * b) / a, y: -big };
        p2 = { x: (c - big * b) / a, y: big };
      }
      lines.push([p1, p2]);
    });

    const rawCells = stellBuildCells(boundBox, lines, eps);

    // Real shapes are never perfectly exact (coordinates get rounded
    // when exported/imported, and solids are stored to 4 decimals), so
    // planes that should meet at exactly one point or line miss by a
    // hair. That shows up as sliver cells between near-identical lines
    // and tiny triangles around near-concurrent points, whose corners
    // then fail to line up with their neighbours' when cells are
    // merged back into faces. So: snap every corner within a tiny
    // tolerance onto one shared point, and drop any cell that collapses
    // (a sliver ends up with only two distinct corners). Neighbouring
    // cells then share corners exactly instead of "almost".
    const snapTol = Math.max(maxR * 5e-5, planeNoise * 8, 1e-7);
    const snapGrid = new Map();
    let snapCount = 0;
    function snapPoint(pt) {
      const ix = Math.floor(pt.x / snapTol),
        iy = Math.floor(pt.y / snapTol);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = snapGrid.get(ix + dx + "," + (iy + dy));
          if (!bucket) continue;
          for (const rep of bucket) {
            if (
              Math.abs(rep.x - pt.x) < snapTol &&
              Math.abs(rep.y - pt.y) < snapTol
            )
              return rep;
          }
        }
      }
      const rep = { x: pt.x, y: pt.y, id: snapCount++ };
      const key = ix + "," + iy;
      if (!snapGrid.has(key)) snapGrid.set(key, []);
      snapGrid.get(key).push(rep);
      return rep;
    }
    const cells = [];
    const cellUnbounded = [];
    rawCells.forEach((raw) => {
      // Decided from the raw corners, before snapping can nudge them
      // off the bounding square's edge.
      const touchesBox = raw.some(
        (q) =>
          Math.abs(Math.abs(q.x) - S) < eps * 4 ||
          Math.abs(Math.abs(q.y) - S) < eps * 4,
      );
      const snapped = [];
      raw.forEach((q) => {
        const rep = snapPoint(q);
        if (snapped[snapped.length - 1] !== rep) snapped.push(rep);
      });
      while (snapped.length > 1 && snapped[0] === snapped[snapped.length - 1])
        snapped.pop();
      if (snapped.length < 3 || stellPolyArea(snapped) < snapTol * snapTol)
        return;
      cells.push(snapped);
      cellUnbounded.push(touchesBox);
    });
    // A face that has already been stellated lies in the very same
    // plane as before, so its diagram is identical to the original's -
    // what differs is how much of that diagram the face covers. A cell
    // counts as "original" (part of the shape as it stands) when it
    // lies inside this face's actual current outline, so a star-shaped
    // face starts with all of its cells on, not just the centre one.
    const outline2D = poly.map((idx) => {
      const rel = vertices[idx].clone().sub(planeF.centroid);
      return { x: rel.dot(planeF.u), y: rel.dot(planeF.v) };
    });
    const faceRegions = cells.map((cell, ci) => {
      let cx = 0,
        cy = 0;
      cell.forEach((q) => {
        cx += q.x;
        cy += q.y;
      });
      const mid = { x: cx / cell.length, y: cy / cell.length };
      return {
        face: fi,
        poly2D: cell,
        mid2D: mid,
        plane: planeF,
        isOriginal: stellWindingContains(outline2D, mid),
        // A cell touching the edge of the bounding square runs off to
        // infinity (it only stops there because we cut it off), so it
        // can never be part of a finite polyhedron.
        unbounded: cellUnbounded[ci],
        neighbors: [],
      };
    });
    if (!faceRegions.some((r) => r.isOriginal)) {
      const centre = faceRegions.find((r) =>
        stellPointInside(r.poly2D, { x: 0, y: 0 }, eps),
      );
      if (centre) centre.isOriginal = true;
    }

    // Two cells in the same face's own diagram are neighbours if they
    // share a whole edge - this is what toggling a cell off reveals.
    // Snapping made shared corners the very same point, and in a full
    // arrangement of lines an edge never has another corner partway
    // along it, so shared edges are found by their two corners' ids.
    const edgeOwners = new Map();
    faceRegions.forEach((r) => {
      edgesOf(r.poly2D).forEach(([a, b]) => {
        const key = Math.min(a.id, b.id) + "," + Math.max(a.id, b.id);
        const owner = edgeOwners.get(key);
        if (!owner) edgeOwners.set(key, r);
        else if (owner !== r && !owner.neighbors.includes(r)) {
          owner.neighbors.push(r);
          r.neighbors.push(owner);
        }
      });
    });

    regions.push(...faceRegions);
  });

  return regions;
}

// What toggling `toggled` off reveals: its neighbours within its own
// face's diagram (see computeStellationRegions for why it's same-face
// only, not cross-face).
function findBorderingRegions(toggled) {
  return toggled.neighbors;
}

// Merges a group of cells from the SAME face's diagram - the cell that
// was toggled off plus the neighbours it revealed - into a single
// outer boundary loop (e.g. a pentagon's own cell plus its 5 revealed
// tip cells becomes one pentagram-shaped loop). This has to happen
// before the shape is built: if each cell stayed a separate face, a
// single logical face (and the vertex it's "one face" of, for the
// dual's face-per-vertex bookkeeping) would be split into several,
// throwing off face/vertex degree counts the dual depends on.
// All members share one plane, so this works directly in that
// face's own 2D coordinates: collect every cell's edges, cancel any
// edge that appears forwards in one cell and backwards in another
// (an internal, shared edge), and walk what's left into one loop.
function mergeFaceCellGroup(group) {
  if (group.length === 1) return group[0].poly2D.slice();

  let maxCoord = 0;
  group.forEach((r) =>
    r.poly2D.forEach((p) => {
      maxCoord = Math.max(maxCoord, Math.abs(p.x), Math.abs(p.y));
    }),
  );
  const eps = Math.max(maxCoord * 1e-6, 1e-9);
  function pointsMatch(a, b) {
    return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  }

  const edges = [];
  group.forEach((r) => {
    const poly = r.poly2D;
    for (let i = 0; i < poly.length; i++)
      edges.push([poly[i], poly[(i + 1) % poly.length]]);
  });

  const used = new Array(edges.length).fill(false);
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    for (let j = i + 1; j < edges.length; j++) {
      if (used[j]) continue;
      if (
        pointsMatch(edges[i][0], edges[j][1]) &&
        pointsMatch(edges[i][1], edges[j][0])
      ) {
        used[i] = true;
        used[j] = true;
        break;
      }
    }
  }
  const boundary = edges.filter((_, i) => !used[i]);
  if (boundary.length === 0) return [];

  const loop = [boundary[0][0]];
  let lastPoint = boundary[0][1];
  const consumed = new Array(boundary.length).fill(false);
  consumed[0] = true;
  let guard = boundary.length + 2;
  while (guard-- > 0) {
    if (pointsMatch(lastPoint, loop[0])) break;
    loop.push(lastPoint);
    let found = -1;
    for (let i = 0; i < boundary.length; i++) {
      if (!consumed[i] && pointsMatch(boundary[i][0], lastPoint)) {
        found = i;
        break;
      }
    }
    if (found === -1) break;
    consumed[found] = true;
    lastPoint = boundary[found][1];
  }
  return loop;
}

// Reduces a merged outline to the face's true corners.
//
// Where the old face joins a new region, an edge of the old face and a
// side of the new region lie on one straight line (e.g. a pentagon's
// edge E-A, continued past A by the side of the tip next to it), so the
// old corner A is just a point on a straight run, not a corner of the
// new face. Following the outline alone would still list it, because the
// outline turns there to follow the neighbouring tip. Instead: gather
// every outline edge lying on the same straight line, and where the gap
// between two of them runs through the inside of the shape (the old
// face's own edge), treat them as ONE straight side. The face is then
// the polygon through just the ends of those straight sides. For a
// pentagon plus its 5 tips that is the pentagram's 5 tips - the old
// pentagon corners are only where its sides cross - instead of 10 points.
// If the sides don't chain into a single closed polygon, the plain
// outline is kept.
function stellReduceToCorners(loop) {
  const n = loop.length;
  if (n < 4) return loop;
  let maxCoord = 0;
  loop.forEach(
    (q) => (maxCoord = Math.max(maxCoord, Math.abs(q.x), Math.abs(q.y))),
  );
  const posTol = Math.max(maxCoord * 3e-4, 1e-9);
  const angTol = 2e-3;
  const near = (a, b) =>
    Math.abs(a.x - b.x) < posTol && Math.abs(a.y - b.y) < posTol;

  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i],
      b = loop[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < posTol) continue;
    edges.push({ a, b, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
  }
  if (edges.length < 3) return loop;

  // edges on the same straight line, running the same way
  const lines = [];
  edges.forEach((e) => {
    let line = lines.find((ln) => {
      const f = ln.ref;
      if (Math.abs(f.dx * e.dy - f.dy * e.dx) > angTol) return false;
      if (f.dx * e.dx + f.dy * e.dy < 0) return false;
      return (
        Math.abs((e.a.x - f.a.x) * -f.dy + (e.a.y - f.a.y) * f.dx) < posTol
      );
    });
    if (!line) {
      line = { ref: e, edges: [] };
      lines.push(line);
    }
    line.edges.push(e);
  });

  // join edges on one line across any gap that runs through the shape
  const sides = [];
  lines.forEach((ln) => {
    const f = ln.ref;
    const along = (pt) => (pt.x - f.a.x) * f.dx + (pt.y - f.a.y) * f.dy;
    const sorted = ln.edges.slice().sort((e1, e2) => along(e1.a) - along(e2.a));
    let cur = { a: sorted[0].a, b: sorted[0].b };
    for (let k = 1; k < sorted.length; k++) {
      const e = sorted[k];
      const gap = along(e.a) - along(cur.b);
      let joined = gap <= posTol;
      if (!joined) {
        // The gap has to stay inside the shape. Points on the outline
        // itself count as inside (a side that crosses over old corners
        // passes right through them), otherwise the answer flips with
        // how the face happens to be oriented.
        joined = [1, 2, 3, 4, 5, 6, 7].every((k) => {
          const pt = {
            x: cur.b.x + (k / 8) * (e.a.x - cur.b.x),
            y: cur.b.y + (k / 8) * (e.a.y - cur.b.y),
          };
          if (stellWindingContains(loop, pt)) return true;
          for (let i = 0; i < n; i++) {
            const a = loop[i],
              b = loop[(i + 1) % n];
            const sx = b.x - a.x,
              sy = b.y - a.y;
            const len2 = sx * sx + sy * sy;
            if (len2 === 0) continue;
            const t = Math.max(
              0,
              Math.min(1, ((pt.x - a.x) * sx + (pt.y - a.y) * sy) / len2),
            );
            if (
              Math.hypot(pt.x - (a.x + t * sx), pt.y - (a.y + t * sy)) < posTol
            )
              return true;
          }
          return false;
        });
      }
      if (joined) {
        cur.b = e.b;
      } else {
        sides.push(cur);
        cur = { a: e.a, b: e.b };
      }
    }
    sides.push(cur);
  });

  // the corners are the ends of the sides
  const corners = [];
  const cornerIndex = (pt) => {
    for (let i = 0; i < corners.length; i++) if (near(corners[i], pt)) return i;
    corners.push(pt);
    return corners.length - 1;
  };
  const links = sides.map((sd) => ({
    from: cornerIndex(sd.a),
    to: cornerIndex(sd.b),
    sd,
  }));

  // a corner lying along the middle of another side splits that side
  const pieces = [];
  links.forEach((lk) => {
    const dx = lk.sd.b.x - lk.sd.a.x,
      dy = lk.sd.b.y - lk.sd.a.y;
    const len2 = dx * dx + dy * dy;
    const mids = [];
    corners.forEach((c, ci) => {
      if (ci === lk.from || ci === lk.to) return;
      const t = ((c.x - lk.sd.a.x) * dx + (c.y - lk.sd.a.y) * dy) / len2;
      if (t <= 0 || t >= 1) return;
      const px = lk.sd.a.x + t * dx,
        py = lk.sd.a.y + t * dy;
      if (Math.abs(px - c.x) < posTol && Math.abs(py - c.y) < posTol)
        mids.push({ ci, t });
    });
    mids.sort((m1, m2) => m1.t - m2.t);
    let prev = lk.from;
    mids.forEach((m) => {
      pieces.push({ from: prev, to: m.ci });
      prev = m.ci;
    });
    pieces.push({ from: prev, to: lk.to });
  });

  // chain the pieces into one closed polygon
  const nextOf = new Map();
  for (const pc of pieces) {
    if (nextOf.has(pc.from)) return loop;
    nextOf.set(pc.from, pc.to);
  }
  if (nextOf.size !== corners.length || corners.length < 3) return loop;
  const order = [0];
  let at = nextOf.get(0);
  while (at !== undefined && at !== 0 && order.length <= corners.length) {
    order.push(at);
    at = nextOf.get(at);
  }
  if (at !== 0 || order.length !== corners.length) return loop;
  return order.map((ci) => corners[ci]);
}

// Builds the final vertices/faces from a list of GROUPS (each group is
// one or more same-face cells that should become a single face),
// welding points that different groups happened to land on together
// in 3D into one shared vertex, so the result is a real, edge-connected
// polyhedron rather than a pile of disconnected patches.
function buildShapeFromRegions(groups, groupColors) {
  const loops = [];
  groups.forEach((group, gi) => {
    let loop2D = mergeFaceCellGroup(group);
    if (group.length > 1) loop2D = stellReduceToCorners(loop2D);
    loops.push({
      loop2D,
      plane: group[0].plane,
      color: groupColors ? groupColors[gi] : null,
    });
  });
  return buildShapeFromLoops(loops, !!groupColors);
}

// The welding half of buildShapeFromRegions: `loops` are faces given as
// 2D outlines in their own planes ({ loop2D, plane, color }).
function buildShapeFromLoops(loops, withColors) {
  const rawVerts = [];
  const rawFaces = [];
  const keptColors = [];
  loops.forEach(({ loop2D, plane, color }) => {
    if (loop2D.length < 3) return;
    const base = rawVerts.length;
    loop2D.forEach((p2) => rawVerts.push(stellTo3D(p2, plane)));
    rawFaces.push(loop2D.map((_, i) => base + i));
    if (withColors) keptColors.push(color);
  });
  if (rawVerts.length === 0) return { vertices: [], faces: [], colors: [] };

  let maxR = 0;
  rawVerts.forEach((v) => (maxR = Math.max(maxR, v.length())));
  const eps = Math.max(maxR * 1e-4, 1e-6);
  const welded = [];
  function weld(p) {
    for (let i = 0; i < welded.length; i++) {
      if (welded[i].distanceTo(p) < eps) return i;
    }
    welded.push(p.clone());
    return welded.length - 1;
  }
  const weldedFaces = rawFaces.map((poly) =>
    poly.map((idx) => weld(rawVerts[idx])),
  );

  // A clip can emit two near-duplicate points at a corner (the original
  // vertex plus an almost-identical intersection point); both weld to
  // the same vertex, leaving that index repeated back-to-back in the
  // face - a zero-length edge that corrupts the manifold check and any
  // further use of the shape. Collapse those repeats (including the
  // wrap-around between the last and first point) before using the
  // faces for anything. Colors are filtered in lockstep so they stay
  // aligned with whichever faces actually survive.
  const cleanedFaces = weldedFaces.map((poly) =>
    poly.filter((idx, i) => idx !== poly[(i - 1 + poly.length) % poly.length]),
  );
  const faces = [];
  const finalColors = [];
  cleanedFaces.forEach((poly, i) => {
    if (poly.length < 3) return;
    faces.push(poly);
    if (withColors) finalColors.push(keptColors[i]);
  });

  return {
    vertices: welded,
    faces: normalizeFaceWinding(welded, faces),
    colors: finalColors,
  };
}

// ---------------------------------------------------------------
// A stellation session, without the UI: the map's regions carry
// on / addedThisSession / locked flags, and every face grown so far
// leaves a merge group behind. The map screen drives these step by
// step; a replay (actions.js) runs the same steps on a fresh map.
// ---------------------------------------------------------------
function startStellationSession(regions) {
  regions.forEach((r) => {
    r.on = r.isOriginal;
    r.addedThisSession = false;
    r.locked = false;
  });
}

// The cells currently making up a face that can still be grown.
function stellFaceFootprint(regions, face) {
  return regions.filter(
    (r) =>
      r.face === face &&
      r.on &&
      r.isOriginal &&
      !r.addedThisSession &&
      !r.locked,
  );
}

// Grows a face outward: the face KEEPS its own cells and gains the
// neighbouring cells (within that same face's own diagram) that
// surround it, and the two are one face from then on (e.g. a pentagon
// plus its 5 revealed tips is one pentagram face). That merged face is
// locked until the stellation is applied, so each face grows one shell
// per session. Recording the cells as one group is also what makes
// them a single face at Apply, which later operations like the dual
// depend on for correct face/vertex counts.
// Returns false (changing nothing) if the face can't grow: the whole
// shell around its outline has to be finite - a cell that runs off to
// infinity can't be part of a polyhedron, and revealing only some of
// the ring leaves a lopsided, unclosed shape.
function stellGrowFace(regions, mergeGroups, face) {
  const outline = stellFaceFootprint(regions, face);
  if (outline.length === 0) return false;
  const revealedSet = new Set();
  let runsOffToInfinity = false;
  outline.forEach((r) => {
    findBorderingRegions(r).forEach((n) => {
      if (n.isOriginal || n.on) return;
      if (n.unbounded) runsOffToInfinity = true;
      else revealedSet.add(n);
    });
  });
  if (runsOffToInfinity || revealedSet.size === 0) return false;
  const revealed = Array.from(revealedSet);
  revealed.forEach((n) => {
    n.on = true;
    n.addedThisSession = true;
    n.locked = true;
  });
  outline.forEach((r) => (r.locked = true));
  mergeGroups.push([...outline, ...revealed]);
  return true;
}

// The groups to build the final shape from: each grown face's merge
// group (its old cells plus whatever it revealed, becoming one face),
// plus every untouched original that's still on as its own face.
function stellSessionGroups(regions, mergeGroups) {
  const consumed = new Set();
  const groups = mergeGroups.map((g) => {
    g.forEach((r) => consumed.add(r));
    return g;
  });
  const byFace = new Map();
  regions
    .filter((r) => r.on && !consumed.has(r))
    .forEach((r) => {
      if (!byFace.has(r.face)) byFace.set(r.face, []);
      byFace.get(r.face).push(r);
    });
  byFace.forEach((cells) => groups.push(cells));
  return groups;
}

// The finished polyhedron of a session: grown faces get `newColor`,
// untouched originals keep their colour from `originalColors`.
// Returns null if nothing is left to build a shape from.
function stellSessionResult(regions, mergeGroups, originalColors, newColor) {
  const groups = stellSessionGroups(regions, mergeGroups);
  if (groups.length === 0) return null;
  const groupColors = groups.map((g) => {
    if (g.some((r) => r.addedThisSession)) return newColor;
    return (originalColors && originalColors[g[0].face]) || null;
  });
  return stellFinishShape(buildShapeFromRegions(groups, groupColors));
}

// Final clean-up shared by every way of building a stellation.
function stellFinishShape(result) {
  if (result.faces.length === 0) return null;
  // Welding and snapping nudge corners by a hair; pull every face
  // back onto a consistent plane so error can't build up pass to pass.
  result.vertices = cleanedVertices(result.vertices, result.faces);
  const pruned = pruneUnusedVertices(result.vertices, result.faces);
  return {
    vertices: pruned.vertices,
    faces: pruned.faces,
    colors: result.colors,
  };
}

// Grows every face by one shell at once: the next stellation along the
// main line (dodecahedron -> small stellated dodecahedron -> great
// dodecahedron -> great stellated dodecahedron). It's described without
// face numbers, so it means the same thing on any shape. Returns false
// if some face can't grow (e.g. it's already the last stellation).
function stellGrowAllFaces(regions, mergeGroups) {
  const faces = [];
  regions.forEach((r) => {
    if (!faces.includes(r.face)) faces.push(r.face);
  });
  for (const face of faces) {
    if (stellFaceFootprint(regions, face).length === 0) continue;
    if (!stellGrowFace(regions, mergeGroups, face)) return false;
  }
  return mergeGroups.length > 0;
}

// ---------------------------------------------------------------
// Picking cells by hand. Each face's diagram is cut into cells; any set
// of switched-on cells can be built into a shape. To keep the shape
// symmetric, cells come in orbits: a cell and every cell the shape's
// rotations carry it to (in its own face's diagram and every other
// face's), all switched together. Only rotations are used - not
// reflections - so a cell and its mirror image stay separate choices,
// which is what allows chiral stellations.
// ---------------------------------------------------------------
function stellFaceKey(face) {
  return face
    .slice()
    .sort((a, b) => a - b)
    .join(",");
}
function stellMatrixFromColumns(a, b, c) {
  return new THREE.Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z);
}

// Every rotation of the polyhedron that carries faces onto faces, as
// { matrix, centre, faceMap } (faceMap[f] = the face f is carried to).
// Always includes the identity.
function polyhedronRotations(vertices, faces) {
  const centre = new THREE.Vector3();
  vertices.forEach((v) => centre.add(v));
  centre.divideScalar(Math.max(vertices.length, 1));
  const rotations = [
    { matrix: new THREE.Matrix3(), centre, faceMap: faces.map((_, i) => i) },
  ];

  // three points that span space pin a linear map down
  const P = vertices.map((v) => v.clone().sub(centre));
  const pick = (score) => {
    let best = -1,
      bestScore = 0;
    P.forEach((q, i) => {
      const s = score(q);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return { best, bestScore };
  };
  const i1 = pick((q) => q.lengthSq());
  if (i1.best < 0) return rotations;
  const size = Math.sqrt(i1.bestScore);
  const i2 = pick((q) => P[i1.best].clone().cross(q).length());
  if (i2.best < 0 || i2.bestScore < size * size * 1e-4) return rotations;
  const c12 = P[i1.best].clone().cross(P[i2.best]);
  const i3 = pick((q) => Math.abs(c12.dot(q)));
  if (i3.best < 0 || i3.bestScore < size * size * size * 1e-4) return rotations;
  const ids = [i1.best, i2.best, i3.best];
  const inverse = stellMatrixFromColumns(...ids.map((i) => P[i])).invert();

  const faceIndex = new Map();
  faces.forEach((f, i) => faceIndex.set(stellFaceKey(f), i));
  let perms = [];
  try {
    perms = findPointSetSymmetries(vertices);
  } catch (err) {
    perms = [];
  }
  perms.forEach((perm) => {
    if (perm.every((j, i) => j === i)) return;
    const faceMap = [];
    for (const f of faces) {
      const k = faceIndex.get(stellFaceKey(f.map((i) => perm[i])));
      if (k === undefined) return; // moves points but not faces
      faceMap.push(k);
    }
    const matrix = stellMatrixFromColumns(
      ...ids.map((i) => P[perm[i]]),
    ).multiply(inverse);
    if (matrix.determinant() <= 0) return; // a reflection
    rotations.push({ matrix, centre, faceMap });
  });
  return rotations;
}

// Sorts the faces into types (faces a rotation carries onto each other)
// and the bounded cells into orbits. Sets region.orbit (-1 for cells
// that run off to infinity) and returns
//   { faceTypes: [{ rep, faces }], orbits: [[region, ...], ...] }
function stellClassifyCells(regions, rotations) {
  const byFace = new Map();
  let maxR = 0;
  regions.forEach((r) => {
    r.orbit = -1;
    if (!byFace.has(r.face)) byFace.set(r.face, []);
    byFace.get(r.face).push(r);
    if (!r.unbounded)
      r.poly2D.forEach(
        (q) => (maxR = Math.max(maxR, Math.abs(q.x), Math.abs(q.y))),
      );
  });
  const tol = Math.max(maxR * 1e-3, 1e-9);

  // the cell of `face` whose centre is at 3D point p, if any
  function cellAt(face, p) {
    const cells = byFace.get(face);
    if (!cells) return null;
    const rel = p.clone().sub(cells[0].plane.centroid);
    const x = rel.dot(cells[0].plane.u),
      y = rel.dot(cells[0].plane.v);
    let best = null,
      bestD = tol;
    cells.forEach((c) => {
      if (c.unbounded) return;
      const d = Math.hypot(c.mid2D.x - x, c.mid2D.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    return best;
  }

  const orbits = [];
  regions.forEach((r) => {
    if (r.unbounded || r.orbit >= 0) return;
    const id = orbits.length;
    const members = [r];
    r.orbit = id;
    const p = stellTo3D(r.mid2D, r.plane).sub(rotations[0].centre);
    rotations.forEach((g) => {
      const img = p.clone().applyMatrix3(g.matrix).add(g.centre);
      const c = cellAt(g.faceMap[r.face], img);
      if (c && c.orbit < 0) {
        c.orbit = id;
        members.push(c);
      }
    });
    orbits.push(members);
  });

  const faceTypes = [];
  const typed = new Set();
  Array.from(byFace.keys())
    .sort((a, b) => a - b)
    .forEach((f) => {
      if (typed.has(f)) return;
      const faces = [];
      rotations.forEach((g) => {
        const img = g.faceMap[f];
        if (byFace.has(img) && !typed.has(img)) {
          typed.add(img);
          faces.push(img);
        }
      });
      faceTypes.push({ rep: f, faces });
    });
  return { faceTypes, orbits };
}

// The switched-on cells, split into faces: in each face's plane, every
// patch of cells joined edge to edge is one face.
function stellSelectionGroups(regions) {
  const groups = [];
  const seen = new Set();
  regions.forEach((r) => {
    if (!r.on || seen.has(r)) return;
    const group = [];
    const stack = [r];
    seen.add(r);
    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      c.neighbors.forEach((n) => {
        if (n.on && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      });
    }
    groups.push(group);
  });
  return groups;
}

// Does `loop` draw exactly the cells of `group`? It has to cover each
// of the face's cells that's in the group and none that isn't, and be
// drawable as a fan from its centre (how faces are rendered) - which
// holds when every edge turns the same way around that centre.
function stellLoopMatchesGroup(loop, group, faceCells) {
  if (loop.length < 3) return false;
  let cx = 0,
    cy = 0;
  loop.forEach((q) => {
    cx += q.x;
    cy += q.y;
  });
  cx /= loop.length;
  cy /= loop.length;
  let sign = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const cross = (a.x - cx) * (b.y - cy) - (a.y - cy) * (b.x - cx);
    if (Math.abs(cross) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  const inGroup = new Set(group);
  return faceCells.every(
    (c) => stellWindingContains(loop, c.mid2D) === inGroup.has(c),
  );
}

// The outlines a group of same-face cells is built from: one face when
// its outline (preferably reduced to true corners, as a pentagram is)
// draws it correctly, otherwise each cell on its own - e.g. a ring of
// cells around a hole can't be one face.
function stellGroupLoops(group, faceCells) {
  if (group.length === 1) return [group[0].poly2D.slice()];
  const loop = mergeFaceCellGroup(group);
  const reduced = stellReduceToCorners(loop);
  if (stellLoopMatchesGroup(reduced, group, faceCells)) return [reduced];
  if (stellLoopMatchesGroup(loop, group, faceCells)) return [loop];
  return group.map((c) => c.poly2D.slice());
}

// The polyhedron the switched-on cells make. A face made only of the
// shape's own cells keeps its colour; one that gained cells gets
// `newColor`. Returns null if no cells are on.
function stellCellSelectionResult(regions, originalColors, newColor) {
  const byFace = new Map();
  regions.forEach((r) => {
    if (!byFace.has(r.face)) byFace.set(r.face, []);
    byFace.get(r.face).push(r);
  });
  const loops = [];
  stellSelectionGroups(regions).forEach((group) => {
    const face = group[0].face;
    const color = group.every((c) => c.isOriginal)
      ? (originalColors && originalColors[face]) || null
      : newColor;
    stellGroupLoops(group, byFace.get(face)).forEach((loop2D) =>
      loops.push({ loop2D, plane: group[0].plane, color }),
    );
  });
  if (loops.length === 0) return null;
  return stellFinishShape(buildShapeFromLoops(loops, true));
}

// A fingerprint of a stellation map, so a recorded cell selection is
// only replayed on a shape whose map is the same.
function stellMapSignature(regions) {
  let h = 2166136261;
  const mix = (n) => {
    h ^= n;
    h = Math.imul(h, 16777619) >>> 0;
  };
  regions.forEach((r) => {
    mix(r.face);
    mix(r.poly2D.length);
    mix(r.isOriginal ? 1 : 0);
    mix(r.unbounded ? 1 : 0);
  });
  return regions.length + ":" + h.toString(16);
}

// Whether a stellation's surface has no gaps. Stricter "every edge is
// shared by exactly two faces" tests reject many real stellations,
// whose faces meet in two ways that leave no gap: a corner of one face
// partway along another's edge, and an edge running across the middle
// of another face (where they pass through each other). So edges are
// first split at any corner lying along them, then an edge belonging
// to just one face still counts as closed when it lies on another face.
function stellLooksClosed(vertices, faces) {
  if (faces.length === 0) return false;
  let maxR = 0;
  vertices.forEach((v) => (maxR = Math.max(maxR, v.length())));
  const tol = Math.max(maxR * 1e-4, 1e-7);

  const uses = new Map();
  faces.forEach((f, fi) => {
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      const A = vertices[a];
      const AB = vertices[b].clone().sub(A);
      const len2 = AB.lengthSq();
      if (len2 === 0) return;
      const stops = [{ t: 0, idx: a }];
      vertices.forEach((p, j) => {
        if (j === a || j === b) return;
        const t = p.clone().sub(A).dot(AB) / len2;
        if (t <= 1e-6 || t >= 1 - 1e-6) return;
        if (A.clone().addScaledVector(AB, t).distanceTo(p) < tol)
          stops.push({ t, idx: j });
      });
      stops.push({ t: 1, idx: b });
      stops.sort((s1, s2) => s1.t - s2.t);
      for (let k = 0; k + 1 < stops.length; k++) {
        const p = stops[k].idx,
          q = stops[k + 1].idx;
        const key = Math.min(p, q) + "_" + Math.max(p, q);
        if (!uses.has(key)) uses.set(key, []);
        uses.get(key).push(fi);
      }
    });
  });

  const planes = faces.map((f) => {
    const n = newellNormal(f, vertices);
    if (n.lengthSq() < 1e-12) return null;
    n.normalize();
    const c = faceCentroidOf(f, vertices);
    let t = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.dot(t)) > 0.9) t = new THREE.Vector3(0, 1, 0);
    const u = t.clone().addScaledVector(n, -t.dot(n)).normalize();
    const v = n.clone().cross(u);
    const to2D = (p) => {
      const rel = p.clone().sub(c);
      return { x: rel.dot(u), y: rel.dot(v) };
    };
    return { n, c, to2D, outline: f.map((i) => to2D(vertices[i])) };
  });
  function onAnotherFace(p, owner) {
    return planes.some((pl, fi) => {
      if (!pl || fi === owner) return false;
      if (Math.abs(p.clone().sub(pl.c).dot(pl.n)) > tol) return false;
      return stellWindingContains(pl.outline, pl.to2D(p));
    });
  }

  for (const [key, owners] of uses) {
    if (owners.length !== 1) continue;
    const [a, b] = key.split("_").map(Number);
    const mid = vertices[a].clone().add(vertices[b]).multiplyScalar(0.5);
    if (!onAnotherFace(mid, owners[0])) return false;
  }
  return true;
}
