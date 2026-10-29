// ---------------------------------------------------------------
// Platonic solid definitions (used only for the five named starting
// shapes; once reordered, a shape becomes a general custom polyhedron)
// ---------------------------------------------------------------
const SOLID_GEOMETRIES = {
  tetrahedron: () => new THREE.TetrahedronGeometry(2.2),
  cube: () => new THREE.BoxGeometry(2.6, 2.6, 2.6),
  octahedron: () => new THREE.OctahedronGeometry(2.2),
  dodecahedron: () => new THREE.DodecahedronGeometry(1.8),
  icosahedron: () => new THREE.IcosahedronGeometry(2.1),
};

const DUAL_MAP = {
  tetrahedron: "tetrahedron",
  cube: "octahedron",
  octahedron: "cube",
  dodecahedron: "icosahedron",
  icosahedron: "dodecahedron",
};

function roundKey(v) {
  return v.x.toFixed(4) + "," + v.y.toFixed(4) + "," + v.z.toFixed(4);
}

function uniqueVerticesFromGeometry(geometry) {
  const posAttr = geometry.attributes.position;
  const seen = new Set();
  const verts = [];
  for (let i = 0; i < posAttr.count; i++) {
    // Rounding is only used to recognise repeats of the same corner;
    // the stored coordinates stay unrounded. Rounding the coordinates
    // themselves (as this used to) knocks a solid's faces slightly
    // off true planes, and that error then compounds with every
    // stellation.
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = x.toFixed(4) + "," + y.toFixed(4) + "," + z.toFixed(4);
    if (!seen.has(key)) {
      seen.add(key);
      verts.push(new THREE.Vector3(x, y, z));
    }
  }
  return verts;
}
