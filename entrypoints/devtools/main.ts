import { browser } from 'wxt/browser';
import { installDevtoolsRelay } from '../../src/bridge/devtools-relay';

const session = crypto.randomUUID();
const dispose = installDevtoolsRelay(browser.runtime, browser.devtools, session);
addEventListener('pagehide', dispose, { once: true });

// Safari requires panel creation before waiting for site-access checks.
// The panel may render a permission error, but it must exist first.
void browser.devtools.panels.create('SW Inspector', '/icons/toolbar.svg', `panel.html?session=${encodeURIComponent(session)}`);
