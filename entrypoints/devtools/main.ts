import { browser } from 'wxt/browser';
import { installDevtoolsRelay, installPanelVisibilityRelay } from '../../src/bridge/devtools-relay';

const session = crypto.randomUUID();
const lifecycle = { hiddenEpoch: 0 };
const dispose = installDevtoolsRelay(browser.runtime, browser.devtools, session, lifecycle);
let closed = false;
let disposeVisibility = () => {};
addEventListener('pagehide', () => {
  closed = true;
  disposeVisibility();
  dispose();
}, { once: true });

// Safari requires panel creation before waiting for site-access checks.
// The panel may render a permission error, but it must exist first.
void browser.devtools.panels.create('SW Inspector', '/icons/toolbar.svg', `panel.html?session=${encodeURIComponent(session)}`).then((panel) => {
  if (!closed) disposeVisibility = installPanelVisibilityRelay(browser.runtime, panel, session, lifecycle);
});
