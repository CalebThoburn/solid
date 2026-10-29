// ---------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const transparentToggle = document.getElementById("transparentToggle");

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

transparentToggle.addEventListener("change", () => {
  settings.transparent = transparentToggle.checked;
  reapplyFaceMaterialSettings();
  if (stellActive) renderStellationView();
});
