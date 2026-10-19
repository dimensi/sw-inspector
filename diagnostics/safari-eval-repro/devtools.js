const reproSession = crypto.randomUUID();

// This listener lives in the devtools entrypoint, not a background script.
// Route by the panel URL token: a missing panel tabId is itself under test.
browser.runtime.onMessage.addListener((message) => {
  if (message?.session !== reproSession) return;
  if (message.type === "native-eval-repro-context") {
    return Promise.resolve({ context: "devtools-page", session: reproSession, ...getReproSnapshot() });
  }
  if (message.type === "native-eval-repro-run") {
    return runNativeRepro();
  }
});

// Always create the panel, before any permission checks or evaluation.
browser.devtools.panels.create("Native Eval Repro", "icon.svg", `panel.html?session=${reproSession}`).then((panel) => {
  appendReproRecord("panel-created", { session: reproSession });
  panel.onShown.addListener((panelWindow) => {
    appendReproRecord("panel-shown", { hasPanelWindow: Boolean(panelWindow) });
    // Optional evidence only. Evaluation does not depend on receiving this
    // same-process Window reference, which is itself under investigation.
    panelWindow?.appendReproRecord?.("onShown-window-connected", {
      devtoolsPage: location.pathname,
      devtoolsTabId: browser.devtools.inspectedWindow.tabId,
    });
  });
}).catch((error) => {
  appendReproRecord("panel-create-error", { message: String(error) });
});
