/**
 * Content script entry: inject overlay into the page.
 */

import { createOverlay } from './overlay/assistant';

const overlayRootId = 'ai-assistant-connector-root';

function init() {
  if (document.getElementById(overlayRootId)) return;
  const { root } = createOverlay({});
  root.id = overlayRootId;
  document.body.appendChild(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
