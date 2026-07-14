import assert from "node:assert/strict";

// Optional browser interaction smoke test. Start Chrome with remote debugging,
// then run: node tests/browser-smoke.mjs 9225
const port = Number(process.argv[2] ?? 9225);
const appPort = Number(process.argv[3] ?? 4173);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(({ type, url }) => type === "page" && url.includes(`127.0.0.1:${appPort}`));
assert(page, "visualizer page was not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#sourceGrid .edge-label'))")) break;
  } catch {
    // The previous execution context can disappear while Chrome is reloading.
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const invalid = await evaluate(`(() => {
  document.querySelector("#resetButton").click();
  if (document.querySelector("#edgeEditor").hidden) document.querySelector("#editButton").click();
  const hit = document.querySelector("#sourceGrid .edge-hit");
  const current = Number(hit.previousElementSibling.getAttribute("aria-label").match(/: (\\d)/)[1]);
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  document.querySelector('[data-edge-value="' + (current % 4) + '"]').click();
  return {
    current,
    status: document.querySelector("#sourceCheck").textContent,
    target: document.querySelector("#targetTitle").textContent,
    nextDisabled: document.querySelector("#nextButton").disabled,
    playDisabled: document.querySelector("#playButton").disabled,
    invalidFaces: document.querySelectorAll("#sourceGrid .input-invalid").length,
  };
})()`);
assert.match(invalid.status, /충돌/);
assert.match(invalid.target, /기다리는 중/);
assert.equal(invalid.nextDisabled, true);
assert.equal(invalid.playDisabled, true);
assert(invalid.invalidFaces > 0);

const restored = await evaluate(`(() => {
  document.querySelector('[data-edge-value="' + (${invalid.current} - 1) + '"]').click();
  return {
    status: document.querySelector("#sourceCheck").textContent,
    editLabel: document.querySelector("#editButton").textContent,
  };
})()`);
assert.match(restored.status, /proper/);
assert.match(restored.editLabel, /입력 완료/);

const explained = await evaluate(`(() => {
  document.querySelector("#editButton").click();
  let changed = document.querySelector("#targetGrid .edge-label.changed.explainable");
  while (!changed && !document.querySelector("#nextButton").disabled) {
    document.querySelector("#nextButton").click();
    changed = document.querySelector("#targetGrid .edge-label.changed.explainable");
  }
  if (!changed) throw new Error("no explainable changed edge was rendered");
  changed.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const details = document.querySelector("#operationDetails");
  return {
    changedLabel: changed.textContent,
    hidden: details.hidden,
    open: details.open,
    summary: document.querySelector("#operationSummary").textContent,
    detail: document.querySelector("#operationDetail").textContent,
  };
})()`);
assert.match(explained.changedLabel, /→/);
assert.equal(explained.hidden, false);
assert.equal(explained.open, true);
assert.match(explained.summary, /α-base/);
assert.match(explained.summary, /diamond Φ/);
assert.match(explained.detail, /마지막 원인/);

const cancelRecovery = await evaluate(`(() => {
  document.querySelector("#resetButton").click();
  const labels = () => [...document.querySelectorAll("#sourceGrid .edge-label text")]
    .map((node) => node.textContent).join("");
  const before = labels();
  document.querySelector("#editButton").click();
  document.querySelector("#randomButton").click();
  document.querySelector("#cancelEditButton").click();
  const after = labels();
  return {
    before,
    after,
    restored: after === before,
    editorHidden: document.querySelector("#edgeEditor").hidden,
  };
})()`);
assert.equal(cancelRecovery.restored, true, JSON.stringify(cancelRecovery));
assert.equal(cancelRecovery.editorHidden, true);

socket.close();
console.log("browser smoke passed: edit conflict/recovery, cancel snapshot, and edge-change explanation");
