const devtoolsButton = document.getElementById("run-devtools-eval");
const devtoolsStatus = document.getElementById("devtools-status");
const reproSession = new URLSearchParams(location.search).get("session");

function requestDevtools(type) {
  return browser.runtime.sendMessage({ type, session: reproSession });
}

// This handshake reads extension metadata only. It never evaluates in the page.
requestDevtools("native-eval-repro-context").then((context) => {
  if (context?.context !== "devtools-page") throw new Error("No matching devtools-page response");
  appendReproRecord("devtools-page-connected", { entrypoint: context });
  devtoolsButton.disabled = false;
  devtoolsStatus.textContent = "Connected through runtime messaging; eval will use devtools.html's browser object.";
}).catch((error) => {
  devtoolsStatus.textContent = `Devtools-page connection failed: ${String(error)}`;
  appendReproRecord("devtools-page-connect-error", { message: String(error) });
});

devtoolsButton.addEventListener("click", async () => {
  appendReproRecord("request-devtools-eval", { expression: "1 + 1" });
  try {
    const records = await requestDevtools("native-eval-repro-run");
    appendReproRecord("devtools-page-result", { records });
  } catch (error) {
    appendReproRecord("devtools-page-message-error", { message: String(error) });
  }
});
