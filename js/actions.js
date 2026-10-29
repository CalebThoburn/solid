// ---------------------------------------------------------------
// Actions: every finished change to a shape, recorded as data so it can
// be replayed on another shape. runAction(shape, action) returns the new
// shape, or null if the action doesn't apply to that shape (a child
// universe whose parent has changed underneath it skips those steps).
// It never modifies the shape it's given.
//
//   { type: "solid", name }                 load a named solid
//   { type: "dual" }
//   { type: "truncate", t, color, preset }  t: cut depth (0.5 = rectified,
//                                           see truncatePolyhedron); preset
//                                           "uniform" / "quasiUniform" re-finds
//                                           that depth on whatever shape it's on
//   { type: "stellate", grows, color }      grows: face indices, in order,
//                                           or "all" (next mainline stellation)
//   { type: "stellateCells", on, signature, color }
//                                           on: indices of the map's cells kept
//   { type: "reorder", faces, colors, vertexCount }
//   { type: "paint", face, color }
//   { type: "resetColors" }
//   { type: "import", data }                exported-text object
//   { type: "loadComponent", comp }         comp: saved polyhedron
//   { type: "addComponent", comp }
// ---------------------------------------------------------------
function runAction(shape, action) {
  switch (action.type) {
    case "solid":
      return solidShape(shape, action.name);

    case "dual": {
      if (!shape.facePolygons) {
        // Still one of the five named solids - use the exact known dual
        return shape.solidName
          ? solidShape(shape, DUAL_MAP[shape.solidName])
          : null;
      }
      const dual = computeDualPolyhedron(
        shape.verts,
        shape.facePolygons,
        shape.dualCentre,
      );
      if (dual.faces.length === 0) return null;
      const pruned = pruneUnusedVertices(dual.vertices, dual.faces);
      return customShape(shape, pruned.vertices, pruned.faces, dual.centre);
    }

    case "truncate": {
      const poly = polygonShapeOf(shape);
      if (!poly || poly.faces.length === 0) return null;
      let t = action.t;
      if (action.preset) {
        const depths = uniformTruncationDepths(poly.verts, poly.faces);
        if (!depths) return null;
        t = action.preset === "uniform" ? depths.truncate : depths.quasi;
        if (t === null) return null;
      }
      const result = truncatePolyhedron(poly.verts, poly.faces, t);
      if (result.error) return null;
      const pruned = pruneUnusedVertices(result.vertices, result.faces);
      const colors = carryColors(
        result.origin,
        shape.facePolygons ? shape.faceColors : null,
        action.color,
      );
      return customShape(shape, pruned.vertices, pruned.faces, null, colors);
    }

    case "stellate":
      return stellateShape(shape, action);

    case "stellateCells": {
      // Cell numbers only mean the same thing on the same stellation map.
      const poly = polygonShapeOf(shape);
      if (!poly || poly.faces.length === 0) return null;
      const regions = computeStellationRegions(
        cleanedVertices(poly.verts, poly.faces),
        poly.faces,
      );
      if (stellMapSignature(regions) !== action.signature) return null;
      regions.forEach((r) => (r.on = false));
      action.on.forEach((i) => (regions[i].on = true));
      const result = stellCellSelectionResult(
        regions,
        shape.facePolygons ? shape.faceColors : null,
        action.color,
      );
      if (!result) return null;
      return customShape(
        shape,
        result.vertices,
        result.faces,
        null,
        result.colors,
      );
    }

    case "reorder": {
      // The faces are lists of point numbers, so they only mean the
      // same thing on a shape with the same points.
      if (shape.verts.length !== action.vertexCount) return null;
      const wound = normalizeFaceWinding(shape.verts, action.faces);
      const pruned = pruneUnusedVertices(shape.verts, wound);
      return {
        verts: pruned.vertices,
        facePolygons: pruned.faces,
        solidName: null,
        solidScale: shape.solidScale,
        faceColors: pruned.faces.map((_, i) => action.colors[i] || null),
        dualCentre: null,
      };
    }

    case "paint": {
      const next = materializedShape(shape);
      if (!next || action.face >= next.facePolygons.length) return null;
      next.faceColors[action.face] = action.color;
      return next;
    }

    case "resetColors": {
      const next = cloneShape(shape);
      if (next.facePolygons)
        next.faceColors = next.facePolygons.map(() => null);
      return next;
    }

    case "import":
      return shapeFromData(action.data);

    case "loadComponent": {
      const c = action.comp;
      return customShape(shape, c.verts, c.faces, null, c.colors);
    }

    case "addComponent": {
      const base = shapeAsComponent(shape);
      if (!base) return null;
      const merged = combinePolyhedra(base, action.comp);
      return customShape(
        shape,
        merged.verts,
        merged.faces,
        null,
        merged.colors,
      );
    }
  }
  return null;
}

// Short label for an action, as shown on a universe's plaque.
function actionLabel(action) {
  switch (action.type) {
    case "solid":
      return action.name.charAt(0).toUpperCase() + action.name.slice(1);
    case "dual":
      return "Dual";
    case "truncate":
      return truncationName(action.t, action.preset, true);
    case "stellate":
      return "Stellate";
    case "stellateCells":
      return "Stellate (cells)";
    case "reorder":
      return "Reorder";
    case "paint":
      return "Paint";
    case "resetColors":
      return "Reset colors";
    case "import":
      return "Import";
    case "loadComponent":
      return "Load " + action.comp.name;
    case "addComponent":
      return "Add " + action.comp.name;
  }
  return action.type;
}

// A saved polyhedron, copied so later edits to the components box can't
// change what an action recorded.
function componentForAction(comp) {
  return {
    name: comp.name,
    verts: comp.verts.map((v) => v.clone()),
    faces: comp.faces.map((f) => f.slice()),
    colors: comp.colors.slice(),
  };
}
