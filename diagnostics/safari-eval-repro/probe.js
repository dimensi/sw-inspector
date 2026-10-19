(() => {
  const context = document.body.dataset.context;
  const output = document.getElementById("output");

  function snapshot() {
    return {
      extensionPage: location.pathname,
      userAgent: navigator.userAgent,
      extensionId: globalThis.browser?.runtime?.id,
      manifestVersion: globalThis.browser?.runtime?.getManifest?.().manifest_version,
      devtoolsType: typeof globalThis.browser?.devtools,
      evalType: typeof globalThis.browser?.devtools?.inspectedWindow?.eval,
      inspectedTabId: globalThis.browser?.devtools?.inspectedWindow?.tabId,
    };
  }

  function appendRecord(event, details = {}) {
    const record = { time: new Date().toISOString(), context, event, ...details };
    const line = JSON.stringify(record, null, 2);
    output.textContent += `${line}\n`;
    console.log(`[Safari Native Eval Repro] ${line}`);
    return record;
  }

  // Each HTML page loads its own copy. The browser object belongs to that page,
  // including when devtools.html is called through runtime.onMessage.
  async function runNativeEval() {
    const records = [];
    function record(event, details) {
      const entry = appendRecord(event, details);
      records.push(entry);
    }

    record("before-eval", { expression: "1 + 1", ...snapshot() });
    try {
      const returned = browser.devtools.inspectedWindow.eval("1 + 1");
      record("eval-returned", {
        returnType: typeof returned,
        thenable: typeof returned?.then === "function",
      });
      const result = await returned;
      record("eval-resolved", { result });
    } catch (error) {
      record("eval-error", { name: error?.name, message: String(error?.message ?? error) });
    }
    return records;
  }

  globalThis.appendReproRecord = appendRecord;
  globalThis.getReproSnapshot = snapshot;
  globalThis.runNativeRepro = runNativeEval;
  document.getElementById("run-eval").addEventListener("click", () => {
    void runNativeEval();
  });
  appendRecord("ready", snapshot());
})();
