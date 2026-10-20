import { browser } from 'wxt/browser';
import { createPanelRelay } from './devtools-relay';
import type { EvalFn } from './transport';

const relay = createPanelRelay(browser.runtime, location.href);

export const evaluateInspectedWindow: EvalFn = relay.evaluate;
export const subscribeInspectedNavigation = relay.subscribeNavigation;

export const subscribePanelReturn = relay.subscribePanelReturn;
