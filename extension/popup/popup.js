/* Toolbar popup — toggles the `enabled` flag the content script reacts to. */
const toggle = document.getElementById('q1o-toggle');

chrome.storage.local.get({ enabled: true }, (s) => {
  toggle.checked = s.enabled !== false;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});
