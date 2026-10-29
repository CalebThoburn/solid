// ---------------------------------------------------------------
// Modal (used for both export and import) - a real in-page dialog
// rather than window.prompt()/alert(), since those are blocked
// entirely in some sandboxed preview environments.
// ---------------------------------------------------------------
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalTextarea = document.getElementById("modalTextarea");
const modalStatus = document.getElementById("modalStatus");
const modalPrimaryBtn = document.getElementById("modalPrimaryBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");

function openModal({ title, initialText, readOnly, primaryLabel, onPrimary }) {
  modalTitle.textContent = title;
  modalTextarea.value = initialText || "";
  modalTextarea.readOnly = !!readOnly;
  modalStatus.textContent = "";
  modalPrimaryBtn.textContent = primaryLabel;
  modalPrimaryBtn.onclick = () => onPrimary(modalTextarea.value);
  modalOverlay.classList.remove("hidden");
  modalTextarea.focus();
  modalTextarea.select();
}

function closeModal() {
  modalOverlay.classList.add("hidden");
}

modalCancelBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

exportBtn.addEventListener("click", () => {
  if (!currentVerts.length) return;
  const text = JSON.stringify(getExportData());
  openModal({
    title: "Export Polyhedron",
    initialText: text,
    readOnly: true,
    primaryLabel: "Copy to Clipboard",
    onPrimary: async () => {
      try {
        await navigator.clipboard.writeText(text);
        modalStatus.textContent = "Copied!";
      } catch (err) {
        modalTextarea.focus();
        modalTextarea.select();
        modalStatus.textContent =
          "Clipboard access blocked here - text is selected, press Ctrl+C (or Cmd+C) to copy it.";
      }
    },
  });
});

importBtn.addEventListener("click", () => {
  openModal({
    title: "Import Polyhedron",
    initialText: "",
    readOnly: false,
    primaryLabel: "Load",
    onPrimary: (text) => {
      if (!text.trim()) {
        modalStatus.textContent = "Paste some polyhedron text first.";
        return;
      }
      try {
        const data = JSON.parse(text);
        shapeFromData(data); // throws with a readable message if it's not a polyhedron
        perform({ type: "import", data });
        closeModal();
      } catch (err) {
        modalStatus.textContent = "Couldn't load that text: " + err.message;
      }
    },
  });
});
