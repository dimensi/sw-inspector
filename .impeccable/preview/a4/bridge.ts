export const evaluateInspectedWindow = async () => ['https://fixture.test', undefined];
export const subscribeInspectedNavigation = cb => { window.a4navigate = cb; return () => { }; };
export const subscribePanelReturn = cb => { window.a4return = cb; return () => { }; };
export const initializePanelActivation = async () => { };
export const requestPanelActivation = async () => { };
export const cancelPanelActivation = () => { };
