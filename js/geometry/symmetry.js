// ---------------------------------------------------------------
// Symmetries of a point set, for "create face uniformly".
//
// A symmetry is a rotation or reflection about the set's centre (every
// symmetry of a point set fixes its average position) that sends the
// set exactly onto itself. Every point that a symmetry can carry some
// point to is "symmetrically similar" to it: same distance from the
// centre and the same arrangement of points around it. Returns each
// symmetry as a permutation: perm[i] = index of the point that point i
// is carried to.
// ---------------------------------------------------------------
// Points that sit within a hair of each other (leftovers of rounding in
// older shapes, where one corner ended up as two almost-identical
// vertices) are treated as one point, then every copy gets the image of
// the first copy in its group.
function findPointSetSymmetries(points) {
  const bounds = boundsCentre(points);
  let extent = 0;
  points.forEach((q) => (extent = Math.max(extent, q.distanceTo(bounds))));
  const tol = Math.max(extent * 2e-4, 1e-9);

  const clusterOf = new Array(points.length);
  const reps = []; // one entry per distinct point: { pos, first }
  points.forEach((q, i) => {
    let c = -1;
    for (let k = 0; k < reps.length; k++) {
      if (reps[k].pos.distanceTo(q) < tol) {
        c = k;
        break;
      }
    }
    if (c < 0) {
      reps.push({ pos: q.clone(), first: i });
      c = reps.length - 1;
    }
    clusterOf[i] = c;
  });

  const clusterPerms = findDistinctPointSymmetries(reps.map((r) => r.pos));
  return clusterPerms.map((cp) =>
    points.map((_, i) => reps[cp[clusterOf[i]]].first),
  );
}

function findDistinctPointSymmetries(points) {
  const n = points.length;
  if (n < 2) return [];
  const centre = new THREE.Vector3();
  points.forEach((q) => centre.add(q));
  centre.divideScalar(n);
  const P = points.map((q) => q.clone().sub(centre));
  const R = P.map((q) => q.length());
  const size = Math.max(...R);
  if (size < 1e-9) return [];
  const tol = Math.max(size * 2e-4, 1e-9);

  // spatial hash so "which point is here?" is a quick lookup
  const cell = tol * 4;
  const grid = new Map();
  P.forEach((q, i) => {
    const key =
      Math.floor(q.x / cell) +
      "," +
      Math.floor(q.y / cell) +
      "," +
      Math.floor(q.z / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  function lookup(x, y, z) {
    const ix = Math.floor(x / cell),
      iy = Math.floor(y / cell),
      iz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(ix + dx + "," + (iy + dy) + "," + (iz + dz));
          if (!bucket) continue;
          for (const i of bucket) {
            if (
              Math.abs(P[i].x - x) < tol &&
              Math.abs(P[i].y - y) < tol &&
              Math.abs(P[i].z - z) < tol
            )
              return i;
          }
        }
      }
    }
    return -1;
  }

  // Two reference points (not in line with the centre) pin a symmetry
  // down once we also say whether it flips handedness, so only their
  // possible images need trying. Take the ones with the fewest
  // look-alikes to keep that list short.
  const sameRadius = R.map(
    (r) => R.filter((r2) => Math.abs(r - r2) < tol).length,
  );
  let ai = -1;
  for (let i = 0; i < n; i++) {
    if (R[i] > tol && (ai < 0 || sameRadius[i] < sameRadius[ai])) ai = i;
  }
  if (ai < 0) return [];
  let bi = -1;
  for (let i = 0; i < n; i++) {
    if (i === ai) continue;
    const cr = P[ai].clone().cross(P[i]).length();
    if (cr > size * size * 1e-3 && (bi < 0 || sameRadius[i] < sameRadius[bi]))
      bi = i;
  }
  if (bi < 0) return []; // every point lies on one line through the centre

  const a = P[ai],
    b = P[bi];
  const nrm = a.clone().cross(b);
  const ab = a.dot(b);
  // inverse of the matrix whose columns are a, b, a x b
  const B = [a.x, b.x, nrm.x, a.y, b.y, nrm.y, a.z, b.z, nrm.z];
  const det =
    B[0] * (B[4] * B[8] - B[5] * B[7]) -
    B[1] * (B[3] * B[8] - B[5] * B[6]) +
    B[2] * (B[3] * B[7] - B[4] * B[6]);
  const Binv = [
    (B[4] * B[8] - B[5] * B[7]) / det,
    (B[2] * B[7] - B[1] * B[8]) / det,
    (B[1] * B[5] - B[2] * B[4]) / det,
    (B[5] * B[6] - B[3] * B[8]) / det,
    (B[0] * B[8] - B[2] * B[6]) / det,
    (B[2] * B[3] - B[0] * B[5]) / det,
    (B[3] * B[7] - B[4] * B[6]) / det,
    (B[1] * B[6] - B[0] * B[7]) / det,
    (B[0] * B[4] - B[1] * B[3]) / det,
  ];

  const symmetries = [];
  for (let aj = 0; aj < n; aj++) {
    if (Math.abs(R[aj] - R[ai]) > tol) continue;
    for (let bj = 0; bj < n; bj++) {
      if (bj === aj || Math.abs(R[bj] - R[bi]) > tol) continue;
      if (Math.abs(P[aj].dot(P[bj]) - ab) > tol * size * 4) continue;
      const nrm2 = P[aj].clone().cross(P[bj]);
      for (const sign of [1, -1]) {
        const c3 = nrm2.clone().multiplyScalar(sign);
        // M = [a' b' c'] * Binv
        const C = [
          P[aj].x,
          P[bj].x,
          c3.x,
          P[aj].y,
          P[bj].y,
          c3.y,
          P[aj].z,
          P[bj].z,
          c3.z,
        ];
        const M = [
          C[0] * Binv[0] + C[1] * Binv[3] + C[2] * Binv[6],
          C[0] * Binv[1] + C[1] * Binv[4] + C[2] * Binv[7],
          C[0] * Binv[2] + C[1] * Binv[5] + C[2] * Binv[8],
          C[3] * Binv[0] + C[4] * Binv[3] + C[5] * Binv[6],
          C[3] * Binv[1] + C[4] * Binv[4] + C[5] * Binv[7],
          C[3] * Binv[2] + C[4] * Binv[5] + C[5] * Binv[8],
          C[6] * Binv[0] + C[7] * Binv[3] + C[8] * Binv[6],
          C[6] * Binv[1] + C[7] * Binv[4] + C[8] * Binv[7],
          C[6] * Binv[2] + C[7] * Binv[5] + C[8] * Binv[8],
        ];
        const perm = new Array(n);
        const taken = new Array(n).fill(false);
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
          const q = P[i];
          const j = lookup(
            M[0] * q.x + M[1] * q.y + M[2] * q.z,
            M[3] * q.x + M[4] * q.y + M[5] * q.z,
            M[6] * q.x + M[7] * q.y + M[8] * q.z,
          );
          if (j < 0 || taken[j]) ok = false;
          else {
            perm[i] = j;
            taken[j] = true;
          }
        }
        if (ok) symmetries.push(perm);
      }
    }
  }
  return symmetries;
}

// Groups the points into kinds: two points are the same kind when some
// symmetry of the whole set carries one onto the other. Returns the kind
// number of every point (kinds numbered in order of first appearance).
function orbitsFromPerms(n, perms) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  perms.forEach((perm) => {
    for (let i = 0; i < n; i++) {
      const a = find(i),
        b = find(perm[i]);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  const kindOfRoot = new Map();
  const kindOf = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!kindOfRoot.has(r)) kindOfRoot.set(r, kindOfRoot.size);
    kindOf.push(kindOfRoot.get(r));
  }
  return { kindOf, count: kindOfRoot.size };
}

// Groups the other points by the plane they would make with points
// ia and ib: every plane through the line ia-ib is one group, so two
// points share a group exactly when all four are coplanar. kindOf is -1
// for points on the line itself (they make no single plane) and for
// ia and ib themselves.
function planeKindsThroughTwo(points, ia, ib) {
  const n = points.length;
  const kindOf = new Array(n).fill(-1);
  const A = points[ia];
  const u = points[ib].clone().sub(A);
  const ul = u.length();
  if (ul < 1e-9) return { kindOf, count: 0 };
  u.divideScalar(ul);
  let size = 0;
  points.forEach((q) => (size = Math.max(size, q.distanceTo(A))));
  const onLine = Math.max(size * 1e-3, 1e-9);
  const normals = [];
  for (let i = 0; i < n; i++) {
    if (i === ia || i === ib) continue;
    const w = points[i].clone().sub(A);
    w.addScaledVector(u, -w.dot(u)); // the part of P - A that points away from the line
    if (w.length() < onLine) continue;
    const nrm = u.clone().cross(w).normalize(); // normal of the plane through A, B and P
    let k = -1;
    for (let r = 0; r < normals.length; r++) {
      // parallel (or opposite) normals = the same plane
      if (normals[r].clone().cross(nrm).length() < 2e-3) {
        k = r;
        break;
      }
    }
    if (k < 0) {
      normals.push(nrm);
      k = normals.length - 1;
    }
    kindOf[i] = k;
  }
  return { kindOf, count: normals.length };
}

// Puts coplanar points in order round their centre (a polygon through
// all of them).
function orderCoplanarPoints(points, members) {
  const c = new THREE.Vector3();
  members.forEach((i) => c.add(points[i]));
  c.divideScalar(members.length);
  let e1 = null,
    best = -1;
  members.forEach((i) => {
    const d = points[i].clone().sub(c);
    if (d.length() > best) {
      best = d.length();
      e1 = d;
    }
  });
  let normal = null;
  best = -1;
  members.forEach((i) => {
    const cr = e1.clone().cross(points[i].clone().sub(c));
    if (cr.length() > best) {
      best = cr.length();
      normal = cr;
    }
  });
  if (!normal || best < 1e-12) return members.slice();
  normal.normalize();
  const u = e1.clone().normalize();
  const w = normal.clone().cross(u);
  const angle = (i) => {
    const d = points[i].clone().sub(c);
    return Math.atan2(d.dot(w), d.dot(u));
  };
  return members.slice().sort((a, b) => angle(a) - angle(b));
}

function gcdInt(a, b) {
  return b === 0 ? a : gcdInt(b, a % b);
}

// Every way to run a polygon through m points in cyclic order: straight
// round (the ordinary polygon) and, from 5 points up, the star polygons
// that step k points at a time ({5/2} is the pentagram).
function polygonOrderings(ordered) {
  const m = ordered.length;
  const out = [{ face: ordered.slice(), step: 1 }];
  for (let k = 2; 2 * k < m; k++) {
    if (gcdInt(m, k) !== 1) continue;
    out.push({
      face: ordered.map((_, i) => ordered[(i * k) % m]),
      step: k,
    });
  }
  return out;
}

// Each edge used by exactly two faces: a closed surface.
function facesFormClosedSurface(faces) {
  const uses = new Map();
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length];
      const key = a < b ? a + "_" + b : b + "_" + a;
      uses.set(key, (uses.get(key) || 0) + 1);
    }
  }
  if (uses.size === 0) return false;
  for (const count of uses.values()) if (count !== 2) return false;
  return true;
}

// All the polyhedra you get by making ONE kind of face and copying it
// uniformly (to every symmetric position) over the point set.
// The kinds of face tried are exactly the ones you can build by hand with
// the colouring modes: take a point of each kind (symmetrically
// different); then a second point of each kind as seen from the first;
// then every plane through those two points (the "same plane" groups);
// the face is the two points plus everything in that plane. Only results
// Every distinct result is kept, closed or not: a set of one kind of
// face that doesn't close up (or whose faces cross themselves, like a
// pentagram) is still a useful part to build a polyhedron from. Each
// result is a list of faces (arrays of point indices) plus whether it
// closes up into a surface.
//
// A generator, so a big shape can be searched in small slices without
// freezing the page: it yields { results, scanned } as it goes and
// finishes with { results, truncated }.
function* enumerateUniformReorderingsGen(points, perms) {
  const n = points.length;
  const results = [];
  if (n < 4 || perms.length === 0) return { results, truncated: false };
  let extent = 0;
  const mid = boundsCentre(points);
  points.forEach((q) => (extent = Math.max(extent, q.distanceTo(mid))));
  const dupTol = Math.max(extent * 1e-3, 1e-9);

  const globalKinds = orbitsFromPerms(n, perms);
  const startPoints = [];
  const seenKind = new Set();
  for (let i = 0; i < n; i++) {
    if (!seenKind.has(globalKinds.kindOf[i])) {
      seenKind.add(globalKinds.kindOf[i]);
      startPoints.push(i);
    }
  }

  const seenPointSets = new Set();
  const seenSurfaces = new Set();
  let scanned = 0;

  for (const P of startPoints) {
    const stabiliser = perms.filter((perm) => perm[P] === P);
    const seenRelative = new Set();
    const relative = orbitsFromPerms(n, stabiliser);
    for (let Q = 0; Q < n; Q++) {
      if (Q === P || seenRelative.has(relative.kindOf[Q])) continue;
      seenRelative.add(relative.kindOf[Q]);
      const planes = planeKindsThroughTwo(points, P, Q);
      for (let g = 0; g < planes.count; g++) {
        scanned++;
        yield { results, scanned };
        const members = [P, Q];
        for (let i = 0; i < n; i++) {
          if (planes.kindOf[i] !== g) continue;
          if (members.some((m) => points[m].distanceTo(points[i]) < dupTol))
            continue;
          members.push(i);
        }
        if (members.length < 3) continue;
        const setKey = members
          .slice()
          .sort((x, y) => x - y)
          .join(",");
        if (seenPointSets.has(setKey)) continue;
        seenPointSets.add(setKey);

        const ordered = orderCoplanarPoints(points, members);
        for (const variant of polygonOrderings(ordered)) {
          const faces = [];
          const keys = new Set();
          for (const perm of perms) {
            const img = variant.face.map((i) => perm[i]);
            if (new Set(img).size < img.length) continue;
            const key = faceCycleKey(img);
            if (keys.has(key)) continue;
            keys.add(key);
            faces.push(img);
          }
          const signature = Array.from(keys).sort().join("|");
          if (seenSurfaces.has(signature)) continue;
          seenSurfaces.add(signature);
          results.push({
            faces,
            sides: variant.face.length,
            step: variant.step,
            closed: facesFormClosedSurface(faces),
          });
        }
      }
    }
  }
  return { results, truncated: false };
}

// Runs the search to the end in one go (used where freezing is fine).
function enumerateUniformReorderings(points, perms) {
  const gen = enumerateUniformReorderingsGen(points, perms);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

// A name for a set of uniformly-copied faces, e.g. "12 pentagrams".
function reorderingName(count, sides, step) {
  const plain = {
    3: "triangles",
    4: "quadrilaterals",
    5: "pentagons",
    6: "hexagons",
    8: "octagons",
    10: "decagons",
  };
  if (step > 1) {
    return (
      count +
      " " +
      (sides === 5 && step === 2
        ? "pentagrams"
        : "{" + sides + "/" + step + "} stars")
    );
  }
  return count + " " + (plain[sides] || sides + "-gons");
}

// Identifies a polyhedron by its geometry (corners rounded to 3
// decimals, each face as a cycle) so the same shape isn't saved twice.
function polyhedronSignature(verts, faces) {
  const id = verts.map(
    (v) => v.x.toFixed(3) + "," + v.y.toFixed(3) + "," + v.z.toFixed(3),
  );
  const cycle = (poly) => {
    const ids = poly.map((i) => id[i]);
    let best = null;
    [ids, ids.slice().reverse()].forEach((seq) => {
      let m = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] < seq[m]) m = i;
      const key = seq.slice(m).concat(seq.slice(0, m)).join(";");
      if (best === null || key < best) best = key;
    });
    return best;
  };
  return faces.map(cycle).sort().join("|");
}

// Combines two polyhedra into one compound: all the corners and faces of
// both, the second's face numbers shifted past the first's corners.
// Puts two polyhedra together as one shape, with corners at the same
// place merged into one - so where their edges line up they become
// shared edges, and face sets that only together go all the way round
// (e.g. 12 pentagrams and 10 hexagons on the same 30 points: the great
// dodecahemicosahedron) form one closed shape.
function joinPolyhedra(a, b) {
  const joined = combinePolyhedra(a, b);
  let size = 0;
  joined.verts.forEach((v) => (size = Math.max(size, v.length())));
  const tol = Math.max(size * 1e-6, 1e-9);
  const verts = [];
  const index = joined.verts.map((v) => {
    let i = verts.findIndex((q) => q.distanceTo(v) < tol);
    if (i < 0) {
      verts.push(v.clone());
      i = verts.length - 1;
    }
    return i;
  });
  return {
    verts,
    faces: joined.faces.map((f) => f.map((i) => index[i])),
    colors: joined.colors,
  };
}

function combinePolyhedra(a, b) {
  const offset = a.verts.length;
  return {
    verts: [...a.verts.map((v) => v.clone()), ...b.verts.map((v) => v.clone())],
    faces: [
      ...a.faces.map((f) => f.slice()),
      ...b.faces.map((f) => f.map((i) => i + offset)),
    ],
    colors: [...a.colors, ...b.colors],
  };
}

function computeVertexOrbits(points) {
  return orbitsFromPerms(points.length, findPointSetSymmetries(points));
}

// A distinct, easy-to-tell-apart colour for each kind of point. Hues are
// spread by the golden ratio so neighbouring kinds never look alike
// however many there are, and the yellow-orange band is skipped because
// amber is what a selected point turns.
function kindColorHex(k) {
  const t = (k * 0.6180339887 + 0.3) % 1;
  const hue = ((75 + t * 300) % 360) / 360; // 15-75 degrees (the yellows/oranges) is left out
  const sat = 0.78;
  const light = 0.5 + 0.12 * (k % 2);
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => {
    const kk = (n + hue * 12) % 12;
    return light - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1));
  };
  const to8 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return (to8(f(0)) << 16) | (to8(f(8)) << 8) | to8(f(4));
}

// One key per distinct face, whichever vertex it is written from and
// whichever way round: used to avoid adding a face that already exists.
function faceCycleKey(poly) {
  const n = poly.length;
  let best = null;
  [poly, poly.slice().reverse()].forEach((seq) => {
    let m = 0;
    for (let i = 1; i < n; i++) if (seq[i] < seq[m]) m = i;
    const key = seq.slice(m).concat(seq.slice(0, m)).join(",");
    if (best === null || key < best) best = key;
  });
  return best;
}
