window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  if (stellGlowMaterials.length) {
    // Two materials pulse together but out of phase with each other:
    // the halo breathes wide while the sharp line stays crisp but
    // still brightens/dims, reading as one glowing outline rather
    // than a flat highlight colour.
    const t = performance.now() * 0.0035;
    const haloMat = stellGlowMaterials[0];
    const sharpMat = stellGlowMaterials[1];
    if (haloMat) haloMat.opacity = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t));
    if (sharpMat)
      sharpMat.opacity = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t + Math.PI / 2));
  }
  renderer.render(scene, camera);
  renderChildStrip();
  renderPinnedView();
}
animate();

// Start with a dodecahedron: the seed of the first universe
enterUniverse(makeUniverse(null, solidShape(emptyShape(), "dodecahedron")));
