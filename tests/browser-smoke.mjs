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
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.reload", { ignoreCache: true });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#sourceGrid .edge-label'))")) break;
  } catch {
    // The previous execution context can disappear while Chrome is reloading.
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const stageSequence = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "3";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();

  const readStage = () => {
    const panel = document.querySelector("#stageExplainer");
    const body = document.querySelector("#stageBody");
    return {
      hidden: panel.hidden,
      kind: panel.dataset.kind ?? "",
      phase: panel.dataset.phase ?? "",
      side: panel.dataset.side ?? "",
      width: panel.dataset.width ?? "",
      title: document.querySelector("#stageExplainerTitle").textContent.trim(),
      body: body.textContent.replace(/\\s+/g, " ").trim(),
      cornerHidden: document.querySelector("#cornerExplainer").hidden,
      neighborHidden: document.querySelector("#neighborExplainer").hidden,
      neighborTitle: document.querySelector("#neighborExplainerTitle").textContent.trim(),
      neighborBody: document.querySelector("#neighborExplainer").textContent.replace(/\\s+/g, " ").trim(),
      changes: [...body.querySelectorAll(".stage-change")].map((node) => ({
        edgeKey: node.dataset.edgeKey ?? "",
        from: node.dataset.from ?? "",
        to: node.dataset.to ?? "",
        text: node.textContent.replace(/\\s+/g, "").trim(),
      })),
    };
  };

  const stages = [readStage()];
  for (let guard = 0; guard < 12 && !document.querySelector("#nextButton").disabled; guard += 1) {
    document.querySelector("#nextButton").click();
    stages.push(readStage());
  }
  return stages;
})()`);

assert.equal(stageSequence.length, 7, JSON.stringify(stageSequence));
assert.deepEqual(
  stageSequence.map(({ kind, phase, side, width }) => ({ kind, phase, side, width })),
  [
    { kind: "input", phase: "input", side: "", width: "" },
    { kind: "interface", phase: "interface", side: "", width: "" },
    { kind: "plus-first", phase: "plus", side: "+", width: "1" },
    { kind: "plus-second", phase: "plus", side: "+", width: "2" },
    { kind: "minus-first", phase: "minus", side: "-", width: "1" },
    { kind: "minus-second", phase: "minus", side: "-", width: "2" },
    { kind: "complete", phase: "complete", side: "", width: "" },
  ],
);

const [inputStage, interfaceStage, plusFirstStage, plusSecondStage, minusFirstStage, minusSecondStage, completeStage] = stageSequence;
assert.equal(inputStage.hidden, false);
assert.match(inputStage.title, /입력/);
assert.equal(interfaceStage.hidden, false);
assert.match(interfaceStage.title, /대각선/);
assert.equal(plusFirstStage.hidden, true);
assert.equal(plusFirstStage.cornerHidden, false);
assert.equal(plusFirstStage.neighborHidden, true);
assert.equal(plusSecondStage.hidden, true);
assert.equal(plusSecondStage.cornerHidden, true);
assert.equal(plusSecondStage.neighborHidden, false);
assert.equal(minusFirstStage.hidden, false);
assert.equal(minusFirstStage.cornerHidden, true);
assert.equal(minusFirstStage.neighborHidden, true);
assert.match(`${minusFirstStage.title} ${minusFirstStage.body}`, /오른쪽 아래/);
assert.match(`${minusFirstStage.title} ${minusFirstStage.body}`, /첫|1/);
assert.equal(minusSecondStage.hidden, true);
assert.equal(minusSecondStage.cornerHidden, true);
assert.equal(minusSecondStage.neighborHidden, false);
assert.match(`${minusSecondStage.neighborTitle} ${minusSecondStage.neighborBody}`, /오른쪽 아래|L·U/);
assert.match(minusSecondStage.neighborBody, /①.*②.*③/);
assert.match(minusSecondStage.neighborBody, /[1-4]\s*↔\s*[1-4]/);
assert.doesNotMatch(minusSecondStage.neighborBody, /X·Y·Z|[XYZ] 교환/);
assert.equal(completeStage.hidden, false);
assert.match(completeStage.title, /완성/);

await evaluate(`(() => {
  document.querySelector("#resetButton").click();
  document.querySelector("#nextButton").click();
  document.querySelector("#nextButton").click();
})()`);

const explainer = await evaluate(`(() => ({
  title: document.querySelector("#cornerExplainerTitle").textContent,
  rows: document.querySelectorAll(".pair-rule").length,
  highlightedRows: document.querySelectorAll(".pair-rule.current").length,
  inputColors: document.querySelectorAll("#cornerInput .digit").length,
  shape: document.querySelector("#cornerShape").textContent,
  proofHidden: document.querySelector(".proof-drawer").hidden,
  cornerMarked: [...document.querySelectorAll("#sourceGrid text")].some((node) => node.textContent.includes("첫 칸")),
}))()`);
assert.match(explainer.title, /이 한 칸만/);
assert.equal(explainer.rows, 6);
assert.equal(explainer.highlightedRows, 1);
assert.equal(explainer.inputColors, 4);
assert.match(explainer.shape, /ELBOW|STRAIGHT/);
assert.equal(explainer.proofHidden, true);
assert.equal(explainer.cornerMarked, true);

await evaluate(`document.querySelector("#nextButton").click()`);

const neighborExplainer = await evaluate(`(() => {
  const compact = (node) => node.textContent.replace(/\\s+/g, "").trim();
  const readMiniFace = (node) => {
    const cell = node.querySelector(".neighbor-mini-cell");
    const cellRect = cell.getBoundingClientRect();
    const cellStyle = getComputedStyle(cell);
    return {
      role: node.dataset.faceRole ?? "",
      aria: node.getAttribute("aria-label") ?? "",
      edges: Object.fromEntries([...node.querySelectorAll(".neighbor-mini-edge")].map((edge) => [
        edge.dataset.side,
        {
          value: edge.dataset.value ?? "",
          active: edge.classList.contains("active"),
          changed: edge.classList.contains("changed"),
          muted: edge.classList.contains("muted"),
          badge: edge.querySelector(".neighbor-edge-badge")?.textContent.trim() ?? "",
        },
      ])),
      cell: {
        text: cell.textContent.trim(),
        width: cellRect.width,
        height: cellRect.height,
        borderStyle: cellStyle.borderStyle,
        borderWidth: parseFloat(cellStyle.borderWidth),
      },
    };
  };
  const readResultStep = (selector) => {
    const step = document.querySelector(selector);
    return {
      copy: step.textContent.replace(/\\s+/g, " ").trim(),
      readCopy: step.querySelector(".neighbor-read-row").textContent.replace(/\\s+/g, " ").trim(),
      inputCaptions: [...step.querySelectorAll(".neighbor-face-pair figcaption")].map((node) => node.textContent.trim()),
      inputFaces: [...step.querySelectorAll(".neighbor-face-pair .neighbor-mini-face")].map(readMiniFace),
      chosenCopy: step.querySelector(".neighbor-chosen-change").textContent.replace(/\\s+/g, " ").trim(),
      chosenColors: step.querySelectorAll(".neighbor-chosen-change .digit").length,
      mappings: [...step.querySelectorAll(".neighbor-chosen-change > strong > b")].map(compact),
      resultCopy: step.querySelector(".neighbor-result-row").textContent.replace(/\\s+/g, " ").trim(),
      resultCaptions: [...step.querySelectorAll(".neighbor-face-change figcaption")].map((node) => node.textContent.trim()),
      resultFaces: [...step.querySelectorAll(".neighbor-face-change .neighbor-mini-face")].map(readMiniFace),
    };
  };
  const aStep = document.querySelector("#neighborAStep");
  const aFlow = aStep.querySelector(".neighbor-a-complete-flow");
  const cluster = aFlow.querySelector(".neighbor-face-cluster");
  const clusterRect = cluster.getBoundingClientRect();
  const evidence = document.querySelector(".neighbor-rule-evidence");
  const extra = document.querySelector(".neighbor-extra-details");
  return {
    title: document.querySelector("#neighborExplainerTitle").textContent,
    status: document.querySelector("#neighborStatus").textContent,
    down: readResultStep("#neighborDownStep"),
    right: readResultStep("#neighborRightStep"),
    aLead: aStep.querySelector(".neighbor-a-lead").textContent,
    aFlowCopy: aFlow.textContent.replace(/\\s+/g, " ").trim(),
    aFlowCaptions: [...aFlow.querySelectorAll("figcaption")].map((node) => node.textContent.replace(/\\s+/g, " ").trim()),
    aFlowFaces: [...aFlow.querySelectorAll(":scope > .neighbor-mini-figure .neighbor-mini-face")].map(readMiniFace),
    aFlowArrows: [...aFlow.querySelectorAll(":scope > .neighbor-a-rule-arrow")].map((node) => node.textContent.replace(/\\s+/g, " ").trim()),
    cluster: {
      aria: cluster.getAttribute("aria-label") ?? "",
      width: clusterRect.width,
      height: clusterRect.height,
      cells: [...cluster.querySelectorAll(".neighbor-cluster-cell")].map((cell) => {
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return {
          text: cell.textContent.trim(), width: rect.width, height: rect.height,
          borderStyle: style.borderStyle, borderWidth: parseFloat(style.borderWidth),
        };
      }),
      edges: Object.fromEntries([...cluster.querySelectorAll(".neighbor-cluster-edge")]
        .map((edge) => [edge.dataset.position, edge.dataset.value ?? ""])),
      sharedPositions: [...cluster.querySelectorAll(".neighbor-cluster-edge.shared")]
        .map((edge) => edge.dataset.position),
    },
    clusterNote: aStep.querySelector(".neighbor-cluster-note").textContent.replace(/\\s+/g, " ").trim(),
    evidence: {
      visible: evidence.getClientRects().length > 0 && getComputedStyle(evidence).display !== "none",
      copy: evidence.textContent.replace(/\\s+/g, " ").trim(),
      columns: [...evidence.querySelectorAll("[data-kind-column].current")].map((node) => node.dataset.kindColumn),
      rows: [...evidence.querySelectorAll("[data-kind-row].current")].map((node) => ({
        kind: node.dataset.kindRow, usedBy: node.dataset.usedBy ?? "",
      })),
      cells: [...evidence.querySelectorAll("[data-next-rule].current")].map((node) => ({
        rule: node.dataset.nextRule, usedBy: node.dataset.usedBy ?? "", text: compact(node),
      })),
      ruleCells: evidence.querySelectorAll("[data-next-rule]").length,
    },
    extraOpen: extra.open,
    extraSummary: extra.querySelector("summary").textContent.trim(),
    beforeFaces: extra.querySelectorAll("#neighborBeforeDiagram .state-face").length,
    afterFaces: extra.querySelectorAll("#neighborAfterDiagram .state-face").length,
    sourceRoles: [...document.querySelectorAll("#sourceGrid .next-rule-label")].map((node) => node.textContent).join(" "),
    mainCopy: document.querySelector("#neighborLive").textContent,
  };
})()`);

const SIDES = ["N", "W", "E", "S"];

function assertFaceRectangle(face, role) {
  assert.equal(face.role, role);
  assert.equal(face.cell.text, role);
  assert(face.cell.width >= 50 && face.cell.height >= 50, JSON.stringify(face.cell));
  assert.equal(face.cell.borderStyle, "solid");
  assert(face.cell.borderWidth >= 2);
  assert.deepEqual(Object.keys(face.edges).sort(), [...SIDES].sort());
}

function assertVisibleSides(face, visibleSides = SIDES) {
  for (const side of SIDES) {
    if (visibleSides.includes(side)) assert.match(face.edges[side].value, /^[1-4]$/, `${face.role} ${side}`);
    else assert.equal(face.edges[side].value, "", `${face.role} ${side}`);
  }
}

function assertDirectionalStep(step, role) {
  assert.match(step.readCopy, /선택표에 넣는 두 칸/);
  assert.deepEqual(step.inputCaptions, ["원래 A", `원래 ${role}`]);
  assert.equal(step.inputFaces.length, 2);
  assertFaceRectangle(step.inputFaces[0], "A");
  assertFaceRectangle(step.inputFaces[1], role);
  assertVisibleSides(step.inputFaces[0], ["W", "S"]);
  assertVisibleSides(step.inputFaces[1], ["W", "N"]);
  assert.match(step.chosenCopy, /선택된 숫자 바꾸기/);
  assert.equal(step.chosenColors, 4);
  assert.equal(step.mappings.length, 2);
  const parsed = step.mappings.map((mapping) => mapping.match(/^([1-4])↔([1-4])$/));
  assert(parsed.every(Boolean), JSON.stringify(step.mappings));
  assert.deepEqual(parsed.flatMap((match) => [match[1], match[2]]).sort(), ["1", "2", "3", "4"]);
  assert(parsed.every((match) => match[1] !== match[2]));
  assert.match(step.resultCopy, new RegExp(`${role}에 적용한 결과`));
  assert.deepEqual(step.resultCaptions, ["바꾸기 전", "바꾼 뒤"]);
  assert.equal(step.resultFaces.length, 2);
  const [before, after] = step.resultFaces;
  assertFaceRectangle(before, role);
  assertFaceRectangle(after, role);
  assertVisibleSides(before);
  assertVisibleSides(after);
  assert.equal(step.inputFaces[1].edges.W.value, before.edges.W.value);
  assert.equal(step.inputFaces[1].edges.N.value, before.edges.N.value);
  assert.deepEqual(SIDES.filter((side) => after.edges[side].changed).sort(), ["N", "W"]);
  for (const side of ["W", "N"]) {
    const forward = `${before.edges[side].value}↔${after.edges[side].value}`;
    const reverse = `${after.edges[side].value}↔${before.edges[side].value}`;
    assert(step.mappings.includes(forward) || step.mappings.includes(reverse), `${role} ${side}`);
  }
  for (const side of ["E", "S"]) assert.equal(after.edges[side].value, before.edges[side].value, `${role} ${side}`);
}

assert.match(neighborExplainer.title, /D·R.*함께.*A.*마무리/);
assert.equal(neighborExplainer.status, "");
assertDirectionalStep(neighborExplainer.down, "D");
assertDirectionalStep(neighborExplainer.right, "R");
assert.equal(neighborExplainer.down.inputFaces[0].edges.W.value, neighborExplainer.right.inputFaces[0].edges.W.value);
assert.equal(neighborExplainer.down.inputFaces[0].edges.S.value, neighborExplainer.right.inputFaces[0].edges.S.value);
assert.match(neighborExplainer.aLead, /D에서.*A의 왼쪽 변에만.*R에서.*A의 위쪽 변에만/);
assert.equal(neighborExplainer.aFlowFaces.length, 2);
const [originalA, intermediateA] = neighborExplainer.aFlowFaces;
assertFaceRectangle(originalA, "A");
assertFaceRectangle(intermediateA, "A");
assertVisibleSides(originalA);
assert.equal(originalA.edges.W.value, neighborExplainer.down.inputFaces[0].edges.W.value);
assert.equal(originalA.edges.S.value, neighborExplainer.down.inputFaces[0].edges.S.value);
assert.match(intermediateA.edges.W.value, /^[1-4]$/);
assert.match(intermediateA.edges.N.value, /^[1-4]$/);
assert.equal(intermediateA.edges.E.value, "");
assert.equal(intermediateA.edges.S.value, "");
assert.deepEqual(SIDES.filter((side) => intermediateA.edges[side].changed).sort(), ["N", "W"]);
assert.equal(originalA.edges.W.badge, "D");
assert.equal(originalA.edges.N.badge, "R");
assert.equal(intermediateA.edges.W.badge, "D");
assert.equal(intermediateA.edges.N.badge, "R");
assert(neighborExplainer.down.mappings.some((mapping) =>
  mapping === `${originalA.edges.W.value}↔${intermediateA.edges.W.value}`
  || mapping === `${intermediateA.edges.W.value}↔${originalA.edges.W.value}`));
assert(neighborExplainer.right.mappings.some((mapping) =>
  mapping === `${originalA.edges.N.value}↔${intermediateA.edges.N.value}`
  || mapping === `${intermediateA.edges.N.value}↔${originalA.edges.N.value}`));
assert.equal(neighborExplainer.aFlowArrows.length, 2);
assert.match(neighborExplainer.aFlowArrows[0], /D·R에서 고른.*숫자 바꾸기/);
assert.match(neighborExplainer.aFlowArrows[1], /1단계의.*6줄 표/);
assert.equal(neighborExplainer.aFlowCaptions.length, 3);
assert.match(neighborExplainer.aFlowCaptions[0], /원래 A/);
assert.match(neighborExplainer.aFlowCaptions[1], /중간값.*최종 아님/);
assert.match(neighborExplainer.aFlowCaptions[2], /A·D·R 결과.*(ELBOW|STRAIGHT)/);
assert.equal(neighborExplainer.cluster.width, 264);
assert.equal(neighborExplainer.cluster.height, 224);
assert.deepEqual(neighborExplainer.cluster.cells.map(({ text }) => text), ["A", "R", "D"]);
for (const cell of neighborExplainer.cluster.cells) {
  assert(cell.width >= 75 && cell.height >= 75, JSON.stringify(cell));
  assert.equal(cell.borderStyle, "solid");
  assert(cell.borderWidth >= 2);
}
const expectedClusterPositions = [
  "a-n", "a-w", "shared-east", "shared-south",
  "r-n", "r-e", "r-s", "d-w", "d-e", "d-s",
];
assert.deepEqual(Object.keys(neighborExplainer.cluster.edges).sort(), expectedClusterPositions.sort());
for (const value of Object.values(neighborExplainer.cluster.edges)) assert.match(value, /^[1-4]$/);
assert.deepEqual(neighborExplainer.cluster.sharedPositions.sort(), ["shared-east", "shared-south"]);
assert.equal(neighborExplainer.cluster.edges["shared-east"], neighborExplainer.right.resultFaces[1].edges.W.value);
assert.equal(neighborExplainer.cluster.edges["shared-south"], neighborExplainer.down.resultFaces[1].edges.N.value);
assert.equal(neighborExplainer.cluster.edges["r-n"], neighborExplainer.right.resultFaces[1].edges.N.value);
assert.equal(neighborExplainer.cluster.edges["r-e"], neighborExplainer.right.resultFaces[1].edges.E.value);
assert.equal(neighborExplainer.cluster.edges["r-s"], neighborExplainer.right.resultFaces[1].edges.S.value);
assert.equal(neighborExplainer.cluster.edges["d-w"], neighborExplainer.down.resultFaces[1].edges.W.value);
assert.equal(neighborExplainer.cluster.edges["d-e"], neighborExplainer.down.resultFaces[1].edges.E.value);
assert.equal(neighborExplainer.cluster.edges["d-s"], neighborExplainer.down.resultFaces[1].edges.S.value);
assert.match(neighborExplainer.clusterNote, /D·R 배지.*그 변에 적용한 바꾸기/);
assert.match(neighborExplainer.clusterNote, /보라색 고리.*서로 붙은 같은 변/);
assert.match(neighborExplainer.clusterNote, /숫자는 다른 변으로 이동하지 않습니다/);
assert.equal(neighborExplainer.evidence.visible, true);
assert.match(neighborExplainer.evidence.copy, /근거표.*A의 왼쪽·아래 두 숫자로 열.*D\/R의 왼쪽·위 두 숫자로 행/);
assert.equal(neighborExplainer.evidence.columns.length, 1);
assert(neighborExplainer.evidence.rows.length >= 1 && neighborExplainer.evidence.rows.length <= 2);
assert(neighborExplainer.evidence.cells.length >= 1 && neighborExplainer.evidence.cells.length <= 2);
assert.equal(neighborExplainer.evidence.ruleCells, 9);
const highlightedRowRoles = new Set(neighborExplainer.evidence.rows.flatMap(({ usedBy }) => usedBy.split("·").filter(Boolean)));
const highlightedCellRoles = new Set(neighborExplainer.evidence.cells.flatMap(({ usedBy }) => usedBy.split("·").filter(Boolean)));
assert.deepEqual([...highlightedRowRoles].sort(), ["D", "R"]);
assert.deepEqual([...highlightedCellRoles].sort(), ["D", "R"]);
for (const cell of neighborExplainer.evidence.cells) {
  const cellMappings = cell.text.match(/[1-4]↔[1-4]/g) ?? [];
  for (const role of cell.usedBy.split("·").filter(Boolean)) {
    const shownMappings = role === "D" ? neighborExplainer.down.mappings : neighborExplainer.right.mappings;
    assert.deepEqual([...cellMappings].sort(), [...shownMappings].sort());
  }
}
assert.equal(neighborExplainer.extraOpen, false);
assert.match(neighborExplainer.extraSummary, /이전 단계와 비교 보기/);
assert.equal(neighborExplainer.beforeFaces, 3);
assert.equal(neighborExplainer.afterFaces, 3);
assert.match(neighborExplainer.sourceRoles, /D · 아래/);
assert.match(neighborExplainer.sourceRoles, /R · 오른쪽/);
assert.doesNotMatch(neighborExplainer.mainCopy, /alpha|diamond|proof|β|Φ|GF\(2\)/i);
assert.doesNotMatch(neighborExplainer.mainCopy, /현재 격자의 숫자로 계산|현재 입력에서 첫 칸 A 다음/);
assert.doesNotMatch(neighborExplainer.mainCopy, /X·Y·Z|[XYZ] 교환|종류 I|종류 II|종류 III/);

const genericBand = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "4";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 5; index += 1) document.querySelector("#nextButton").click();

  const panel = document.querySelector("#stageExplainer");
  const body = document.querySelector("#stageBody");
  const readEdges = (selector) => new Map([...document.querySelectorAll(selector + " .edge-label")].flatMap((node) => {
    const match = (node.getAttribute("aria-label") ?? "").match(/edge ([hv])\\[(\\d+)\\]\\[(\\d+)\\]/);
    const valueClass = [...node.classList].find((name) => /^value-\\d$/.test(name));
    return match && valueClass ? [[match[1] + ":" + match[2] + ":" + match[3], Number(valueClass.at(-1)) + 1]] : [];
  }));
  const tupleAt = (edges, x, y) => [
    edges.get("v:" + y + ":" + x),
    edges.get("h:" + (y + 1) + ":" + x),
    edges.get("v:" + y + ":" + (x + 1)),
    edges.get("h:" + y + ":" + x),
  ].join(",");
  const sourceEdges = readEdges("#sourceGrid");
  const targetEdges = readEdges("#targetGrid");
  const mapFaces = [...body.querySelectorAll(".band-map-face")].map((node) => ({
    face: node.dataset.bandFace,
    x: Number(node.dataset.x),
    y: Number(node.dataset.y),
    role: node.dataset.role,
    visits: Number(node.dataset.visits),
    action: node.dataset.action,
    change: node.dataset.change,
    status: node.querySelector(".band-map-status")?.textContent.replace(/\\s+/g, " ").trim() ?? "",
    shape: node.dataset.shape,
    selected: node.classList.contains("selected"),
    disabled: node.disabled,
  }));
  const targetActions = Object.fromEntries([...document.querySelectorAll("#targetGrid .face-region[data-band-action]")]
    .filter((node) => node.dataset.bandAction)
    .map((node) => [node.dataset.faceKey, node.dataset.bandAction]));
  const newInspector = body.querySelector(".band-inspector.new");
  const newX = Number(newInspector.dataset.x);
  const newY = Number(newInspector.dataset.y);
  const candidates = [...newInspector.querySelectorAll(".band-candidate")].map((node) => ({
    shift: Number(node.dataset.candidateShift),
    valid: node.dataset.valid === "true",
    selected: node.dataset.selected === "true",
  }));
  const newResult = {
    x: newX,
    y: newY,
    shift: Number(newInspector.dataset.shift),
    before: newInspector.querySelector(".band-face-flow").dataset.before,
    after: newInspector.querySelector(".band-face-flow").dataset.after,
    sourceTuple: tupleAt(sourceEdges, newX, newY),
    targetTuple: tupleAt(targetEdges, newX, newY),
    activeBefore: [...newInspector.querySelectorAll(".neighbor-mini-figure:first-child .neighbor-mini-edge.active")].map((node) => node.dataset.side),
    candidates,
    constraintCount: newInspector.querySelectorAll(".band-constraint-pairs > span").length,
  };
  const oldButton = body.querySelector('.band-map-face.old[data-visits="1"]');
  oldButton.click();
  const oldInspector = body.querySelector(".band-inspector.old");
  const oldVisits = [...oldInspector.querySelectorAll(".band-visit")].map((node) => ({
    primitiveIndex: Number(node.dataset.primitiveIndex),
    phase: node.dataset.phase,
    direct: node.dataset.direct,
    before: node.dataset.before,
    after: node.dataset.after,
    changes: node.querySelectorAll(":scope > div > span").length,
  }));
  return {
    hidden: panel.hidden,
    kind: panel.dataset.kind ?? "",
    phase: panel.dataset.phase ?? "",
    side: panel.dataset.side ?? "",
    width: panel.dataset.width ?? "",
    title: document.querySelector("#stageExplainerTitle").textContent.trim(),
    body: body.textContent.replace(/\\s+/g, " ").trim(),
    cornerHidden: document.querySelector("#cornerExplainer").hidden,
    neighborHidden: document.querySelector("#neighborExplainer").hidden,
    order: [...body.querySelectorAll(".band-order-card")].map((node) => node.textContent.replace(/\\s+/g, " ").trim()),
    currentOrder: Number(body.querySelector(".band-order-card.current").dataset.bandStep),
    mapFaces,
    newResult,
    oldResult: {
      x: Number(oldInspector.dataset.x),
      y: Number(oldInspector.dataset.y),
      visits: Number(oldInspector.dataset.visits),
      before: oldInspector.querySelector(".band-face-flow").dataset.before,
      after: oldInspector.querySelector(".band-face-flow").dataset.after,
      history: oldVisits,
    },
    targetActions,
    finishCopy: body.querySelector(".band-finish").textContent.replace(/\\s+/g, " ").trim(),
  };
})()`);

assert.equal(genericBand.hidden, false);
assert.deepEqual(
  { kind: genericBand.kind, phase: genericBand.phase, side: genericBand.side, width: genericBand.width },
  { kind: "band", phase: "plus", side: "+", width: "3" },
);
assert.equal(genericBand.cornerHidden, true);
assert.equal(genericBand.neighborHidden, true);
assert.match(`${genericBand.title} ${genericBand.body}`, /왼쪽 위/);
assert.match(`${genericBand.title} ${genericBand.body}`, /3/);
assert.equal(genericBand.order.length, 3);
assert.match(genericBand.order[0], /안쪽 칸부터 바꾸기.*먼저.*새 칸은 아직/);
assert.match(genericBand.order[1], /새 3칸 붙이기.*다음 · 함께.*한꺼번에/);
assert.match(genericBand.order[2], /남은 안쪽 칸 끝내기.*마지막.*이번 묶음/);
assert.equal(genericBand.currentOrder, 2);
assert.equal(genericBand.mapFaces.length, 6);
assert.equal(genericBand.mapFaces.filter(({ role }) => role === "new").length, 3);
assert.equal(genericBand.mapFaces.filter(({ role }) => role === "old").length, 3);
assert(genericBand.mapFaces.filter(({ role }) => role === "new").every(({ shape, disabled }) => /^(turn|straight)$/.test(shape) && !disabled), JSON.stringify(genericBand.mapFaces));
assert(genericBand.mapFaces.filter(({ role }) => role === "old").every(({ visits }) => visits === 1), JSON.stringify(genericBand.mapFaces));
assert.deepEqual(
  genericBand.mapFaces.filter(({ role }) => role === "new").map(({ visits }) => visits),
  [1, 1, 1],
);
assert(genericBand.mapFaces.filter(({ role }) => role === "new").every(({ action, status }) => action === "joining" && /지금 붙임/.test(status)));
assert(genericBand.mapFaces.filter(({ role }) => role === "old").every(({ action, status }) => action === "affected" && /같이 바꿈|바뀌고 돌아옴/.test(status)));
assert(genericBand.mapFaces.every(({ face, action }) => genericBand.targetActions[face] === action), JSON.stringify(genericBand));
assert.deepEqual({ x: genericBand.newResult.x, y: genericBand.newResult.y }, { x: 0, y: 1 });
assert.equal(genericBand.newResult.before, genericBand.newResult.sourceTuple);
assert.equal(genericBand.newResult.after, genericBand.newResult.targetTuple);
assert.deepEqual(genericBand.newResult.activeBefore.sort(), ["N", "W"]);
assert.equal(genericBand.newResult.candidates.length, 3);
assert.equal(genericBand.newResult.candidates.filter(({ selected }) => selected).length, 1);
assert.equal(genericBand.newResult.candidates.find(({ selected }) => selected).shift, genericBand.newResult.shift);
assert.equal(genericBand.newResult.candidates.find(({ valid }) => valid).shift, genericBand.newResult.shift);
assert(genericBand.newResult.constraintCount >= 2 && genericBand.newResult.constraintCount <= 3);
assert.equal(genericBand.oldResult.visits, 1, JSON.stringify(genericBand.oldResult));
assert.equal(genericBand.oldResult.history.length, genericBand.oldResult.visits);
assert(genericBand.oldResult.history.every(({ changes }) => changes > 0));
assert(genericBand.oldResult.history.every(({ primitiveIndex }, index, items) => index === 0 || primitiveIndex > items[index - 1].primitiveIndex));
assert.equal(genericBand.oldResult.history[0].before, genericBand.oldResult.before);
assert.equal(genericBand.oldResult.history.at(-1).after, genericBand.oldResult.after);
assert(genericBand.oldResult.history.every(({ before }, index, items) => index === 0 || before === items[index - 1].after));
assert.match(genericBand.finishCopy, /② 다음 · 새 3칸 붙이기.*남은 안쪽 칸/);
assert.doesNotMatch(genericBand.body, /\\d+번 영향|계산 영향|내부 계산 \\d+회|중심 계산 \\d+회/);
assert.doesNotMatch(genericBand.body, /alpha|diamond|proof|β|Φ|GF\(2\)|X·Y·Z/i);

const bandMacroRoundTrip = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "4";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 4; index += 1) document.querySelector("#nextButton").click();

  const read = () => {
    const stage = document.querySelector("#stageExplainer");
    const params = new URLSearchParams(location.hash.slice(1));
    const faces = [...stage.querySelectorAll(".band-map-face")];
    const actionCounts = Object.fromEntries(["waiting", "joining", "affected", "joined", "quiet"]
      .map((action) => [action, faces.filter((node) => node.dataset.action === action).length]));
    const targetActions = new Map([...document.querySelectorAll("#targetGrid .face-region[data-band-action]")]
      .map((node) => [node.dataset.faceKey, node.dataset.bandAction]));
    const targetSignature = [...document.querySelectorAll("#targetGrid .edge-label")]
      .map((node) => {
        const key = (node.getAttribute("aria-label") ?? "").match(/edge ([hv])\\[(\\d+)\\]\\[(\\d+)\\]/);
        const value = [...node.classList].find((name) => /^value-\\d$/.test(name));
        return key && value ? key.slice(1).join(":") + "=" + value.at(-1) : "";
      }).filter(Boolean).sort().join("|");
    return {
      kind: stage.dataset.kind,
      frame: Number(params.get("f")),
      hashStep: Number(params.get("b")),
      currentStep: Number(stage.querySelector(".band-order-card.current")?.dataset.bandStep),
      title: document.querySelector("#stageExplainerTitle").textContent.trim(),
      targetSignature,
      changed: Number((document.querySelector("#changeBadge").textContent.match(/\\d+/) ?? [0])[0]),
      disabledNew: faces.filter((node) => node.dataset.role === "new" && node.disabled).length,
      shapedFaces: faces.filter((node) => /^(turn|straight)$/.test(node.dataset.shape)).length,
      evidence: Boolean(stage.querySelector(".band-rule-evidence")),
      actionCounts,
      actionsMatchTarget: faces.every((node) => targetActions.get(node.dataset.bandFace) === node.dataset.action),
      copy: stage.textContent.replace(/\\s+/g, " ").trim(),
    };
  };

  const step1 = read();
  document.querySelector("#nextButton").click();
  const step2 = read();
  document.querySelector("#nextButton").click();
  const step3 = read();
  document.querySelector("#previousButton").click();
  const previousTo2 = read();
  document.querySelector('[data-band-step="1"]').click();
  const cardTo1 = read();
  document.querySelector('[data-band-step="3"]').click();
  const cardTo3 = read();
  document.querySelector("#nextButton").click();
  const nextStage = read();
  document.querySelector("#previousButton").click();
  const returnedTo3 = read();
  return { step1, step2, step3, previousTo2, cardTo1, cardTo3, nextStage, returnedTo3 };
})()`);

assert.equal(bandMacroRoundTrip.step1.kind, "band");
assert.deepEqual(
  [bandMacroRoundTrip.step1.currentStep, bandMacroRoundTrip.step2.currentStep, bandMacroRoundTrip.step3.currentStep],
  [1, 2, 3],
);
assert.deepEqual(
  [bandMacroRoundTrip.step1.hashStep, bandMacroRoundTrip.step2.hashStep, bandMacroRoundTrip.step3.hashStep],
  [1, 2, 3],
);
assert.equal(bandMacroRoundTrip.step1.frame, bandMacroRoundTrip.step2.frame);
assert.equal(bandMacroRoundTrip.step2.frame, bandMacroRoundTrip.step3.frame);
assert(bandMacroRoundTrip.step1.changed > 0 && bandMacroRoundTrip.step2.changed > 0 && bandMacroRoundTrip.step3.changed > 0);
assert.equal(bandMacroRoundTrip.step1.disabledNew, 3);
assert.equal(bandMacroRoundTrip.step1.actionCounts.waiting, 3);
assert.equal(bandMacroRoundTrip.step1.evidence, false);
assert.equal(bandMacroRoundTrip.step2.disabledNew, 0);
assert.equal(bandMacroRoundTrip.step2.actionCounts.joining, 3);
assert.equal(bandMacroRoundTrip.step2.evidence, true);
assert.equal(bandMacroRoundTrip.step3.shapedFaces, 6);
assert.equal(bandMacroRoundTrip.step3.actionCounts.joined, 3);
assert.equal(bandMacroRoundTrip.step3.evidence, false);
assert([bandMacroRoundTrip.step1, bandMacroRoundTrip.step2, bandMacroRoundTrip.step3].every(({ actionsMatchTarget }) => actionsMatchTarget));
assert.notEqual(bandMacroRoundTrip.step1.targetSignature, bandMacroRoundTrip.step2.targetSignature);
assert.notEqual(bandMacroRoundTrip.step2.targetSignature, bandMacroRoundTrip.step3.targetSignature);
assert.deepEqual(bandMacroRoundTrip.previousTo2, bandMacroRoundTrip.step2);
assert.deepEqual(bandMacroRoundTrip.cardTo1, bandMacroRoundTrip.step1);
assert.deepEqual(bandMacroRoundTrip.cardTo3, bandMacroRoundTrip.step3);
assert.equal(bandMacroRoundTrip.nextStage.kind, "minus-first");
assert.equal(bandMacroRoundTrip.nextStage.frame, bandMacroRoundTrip.step3.frame + 1);
assert.equal(bandMacroRoundTrip.returnedTo3.currentStep, 3);
assert.equal(bandMacroRoundTrip.returnedTo3.targetSignature, bandMacroRoundTrip.step3.targetSignature);
assert.match(bandMacroRoundTrip.step1.copy, /먼저.*새 3칸은 아직 붙이지/);
assert.match(bandMacroRoundTrip.step2.copy, /다음.*한꺼번에/);
assert.doesNotMatch(`${bandMacroRoundTrip.step1.copy} ${bandMacroRoundTrip.step2.copy}`, /••••|번 영향|계산 영향/);

const bandOperationScope = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "4";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 4; index += 1) document.querySelector("#nextButton").click();
  const before = {
    summary: document.querySelector("#operationSummary").textContent.trim(),
    chips: document.querySelectorAll("#operationDetail .trace-chip").length,
  };
  const changedEdge = document.querySelector("#targetGrid .edge-label.changed.explainable");
  changedEdge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const after = {
    summary: document.querySelector("#operationSummary").textContent.trim(),
    chips: document.querySelectorAll("#operationDetail .trace-chip").length,
    open: document.querySelector("#operationDetails").open,
  };
  return { before, after };
})()`);
assert.equal(bandOperationScope.after.open, true);
assert.equal(bandOperationScope.after.summary, bandOperationScope.before.summary);
assert.equal(bandOperationScope.after.chips, bandOperationScope.before.chips);
assert(bandOperationScope.after.chips > 0);

const bandInspectorSelection = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "4";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 5; index += 1) document.querySelector("#nextButton").click();

  const read = () => {
    const map = document.querySelector(".band-map-face.selected");
    const inspector = document.querySelector(".band-inspector");
    const edgeValues = new Map([...document.querySelectorAll("#targetGrid .edge-label")].flatMap((node) => {
      const match = (node.getAttribute("aria-label") ?? "").match(/edge ([hv])\\[(\\d+)\\]\\[(\\d+)\\]/);
      const valueClass = [...node.classList].find((name) => /^value-\\d$/.test(name));
      return match && valueClass ? [[match[1] + ":" + match[2] + ":" + match[3], Number(valueClass.at(-1)) + 1]] : [];
    }));
    const x = Number(map.dataset.x);
    const y = Number(map.dataset.y);
    const tuple = [
      edgeValues.get("v:" + y + ":" + x),
      edgeValues.get("h:" + (y + 1) + ":" + x),
      edgeValues.get("v:" + y + ":" + (x + 1)),
      edgeValues.get("h:" + y + ":" + x),
    ].join(",");
    return {
      mapKey: map.dataset.bandFace,
      mapX: x,
      mapY: y,
      inspectorX: Number(inspector.dataset.x),
      inspectorY: Number(inspector.dataset.y),
      selectedMapCount: document.querySelectorAll(".band-map-face.selected").length,
      gridSelectionMarkers: document.querySelectorAll(".band-selected-face, .band-selected-overlay").length,
      targetTuple: tuple,
      inspectorAfter: inspector.querySelector(".band-face-flow")?.dataset.after ?? "",
      activeKey: document.activeElement?.dataset.bandFace ?? "",
      stageCopy: document.querySelector("#stageBody").textContent.replace(/\\s+/g, " ").trim(),
    };
  };

  const initialNew = read();
  const old = document.querySelector('.band-map-face[data-role="old"]');
  old.click();
  const selectedOld = read();
  document.querySelector('[data-band-step="1"]').click();
  document.querySelector('.band-map-face[data-role="old"]').click();
  const step1Old = read();
  document.querySelector('[data-band-step="3"]').click();
  document.querySelector('.band-map-face[data-role="old"]').click();
  const step3Old = read();
  return { initialNew, selectedOld, step1Old, step3Old };
})()`);

for (const snapshot of Object.values(bandInspectorSelection)) {
  assert.equal(snapshot.selectedMapCount, 1);
  assert.equal(snapshot.gridSelectionMarkers, 0);
  assert.deepEqual([snapshot.inspectorX, snapshot.inspectorY], [snapshot.mapX, snapshot.mapY]);
  assert.equal(snapshot.targetTuple, snapshot.inspectorAfter);
  assert.doesNotMatch(snapshot.stageCopy, /큰 격자.*같은 위치|보라색 테두리/);
}
assert.equal(bandInspectorSelection.selectedOld.activeKey, bandInspectorSelection.selectedOld.mapKey);
assert.equal(bandInspectorSelection.step1Old.activeKey, bandInspectorSelection.step1Old.mapKey);
assert.equal(bandInspectorSelection.step3Old.activeKey, bandInspectorSelection.step3Old.mapKey);
assert.notEqual(bandInspectorSelection.initialNew.mapKey, bandInspectorSelection.selectedOld.mapKey);

const randomStageSweep = await evaluate(`(() => {
  const failures = [];
  const select = document.querySelector("#nSelect");
  for (let n = 1; n <= 6; n += 1) {
    for (let sample = 0; sample < 3; sample += 1) {
      select.value = String(n);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#randomButton").click();
      document.querySelector("#resetButton").click();
      const kinds = [];
      for (let guard = 0; guard < 40; guard += 1) {
        const stage = document.querySelector("#stageExplainer");
        const corner = document.querySelector("#cornerExplainer");
        const neighbor = document.querySelector("#neighborExplainer");
        const visibleCount = [stage, corner, neighbor].filter((node) => !node.hidden).length;
        const text = [stage, corner, neighbor].filter((node) => !node.hidden)
          .map((node) => node.textContent.replace(/\\s+/g, " ").trim()).join(" ");
        kinds.push(stage.dataset.kind ?? "");
        if (visibleCount !== 1) failures.push({ n, sample, frame: kinds.length - 1, reason: "visible", visibleCount });
        if (!stage.dataset.kind) failures.push({ n, sample, frame: kinds.length - 1, reason: "kind" });
        if (!text || /undefined|NaN/.test(text)) failures.push({ n, sample, frame: kinds.length - 1, reason: "copy", text });
        if (stage.dataset.kind === "band") {
          const width = Number(stage.dataset.width);
          const side = stage.dataset.side;
          const macroStep = Number(stage.querySelector(".band-order-card.current")?.dataset.bandStep);
          const mapFaces = [...stage.querySelectorAll(".band-map-face")];
          const newFaces = mapFaces.filter((node) => node.dataset.role === "new");
          const oldFaces = mapFaces.filter((node) => node.dataset.role === "old");
          const inspector = stage.querySelector(".band-inspector.new");
          const selectedCandidates = inspector?.querySelectorAll('.band-candidate[data-selected="true"]') ?? [];
          const selectedCandidate = selectedCandidates[0];
          const firstValid = inspector?.querySelector('.band-candidate[data-valid="true"]');
          if (mapFaces.length !== width * (width + 1) / 2) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-map-count", width, count: mapFaces.length });
          if (newFaces.length !== width || oldFaces.length !== width * (width - 1) / 2) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-role-count", width, newCount: newFaces.length, oldCount: oldFaces.length });
          const faceStateOk = macroStep === 1
            ? newFaces.every((node) => node.disabled && node.dataset.shape === "") && oldFaces.every((node) => !node.disabled)
            : macroStep === 2
              ? newFaces.every((node) => !node.disabled && /^(turn|straight)$/.test(node.dataset.shape))
              : mapFaces.every((node) => !node.disabled && /^(turn|straight)$/.test(node.dataset.shape));
          if (!faceStateOk) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-face-data", macroStep });
          const expectedAction = (node) => macroStep === 1 && node.dataset.role === "new"
            ? "waiting"
            : macroStep === 2 && node.dataset.role === "new"
              ? "joining"
              : macroStep === 3 && node.dataset.role === "new"
                ? "joined"
                : Number(node.dataset.visits) > 0
                  ? "affected"
                  : "quiet";
          if (!mapFaces.every((node) => node.dataset.action === expectedAction(node))) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-action-role", macroStep });
          const targetActions = new Map([...document.querySelectorAll("#targetGrid .face-region[data-band-action]")]
            .map((node) => [node.dataset.faceKey, node.dataset.bandAction]));
          if (!mapFaces.every((node) => targetActions.get(node.dataset.bandFace) === node.dataset.action)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-action-grid-map", macroStep });
          if (macroStep === 2 && (!inspector || selectedCandidates.length !== 1 || selectedCandidate !== firstValid)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-rule-selection" });
          if (macroStep !== 2 && inspector) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-rule-wrong-step", macroStep });
          if (stage.querySelectorAll(".band-order-card").length !== 3) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-order" });
          if (/alpha|diamond|proof|β|Φ|GF\\(2\\)|X·Y·Z/i.test(text)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-jargon", text });

          const baseOffset = n - 1 - width;
          const expectedCoordinates = [];
          for (let layer = 0; layer < width; layer += 1) {
            const rowOffset = baseOffset + layer;
            for (let index = 0; index < width - layer; index += 1) {
              const x = side === "+" ? index : index + rowOffset + 1;
              const y = side === "+" ? index + rowOffset + 1 : index;
              expectedCoordinates.push(x + ":" + y + ":" + (layer === 0 ? "new" : "old"));
            }
          }
          const actualCoordinates = mapFaces.map((node) => node.dataset.x + ":" + node.dataset.y + ":" + node.dataset.role);
          expectedCoordinates.sort();
          actualCoordinates.sort();
          if (JSON.stringify(actualCoordinates) !== JSON.stringify(expectedCoordinates)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-coordinates", expectedCoordinates, actualCoordinates });

          const edgeValues = new Map([...document.querySelectorAll("#targetGrid .edge-label")].flatMap((node) => {
            const match = (node.getAttribute("aria-label") ?? "").match(/edge ([hv])\\[(\\d+)\\]\\[(\\d+)\\]/);
            const valueClass = [...node.classList].find((name) => /^value-\\d$/.test(name));
            return match && valueClass ? [[match[1] + ":" + match[2] + ":" + match[3], Number(valueClass.at(-1))]] : [];
          }));
          const tupleAt = (x, y) => [edgeValues.get("v:" + y + ":" + x), edgeValues.get("h:" + (y + 1) + ":" + x), edgeValues.get("v:" + y + ":" + (x + 1)), edgeValues.get("h:" + y + ":" + x)];
          const tupleShape = ([W, N, E, S]) => W === S && N === E && W !== N ? "turn" : W === E && N === S && W !== N ? "straight" : "";
          if (!mapFaces.every((node) => tupleShape(tupleAt(Number(node.dataset.x), Number(node.dataset.y))) === node.dataset.shape)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-shape-vs-grid" });

          if (inspector) {
            const flow = inspector.querySelector(".band-face-flow");
            const before = flow.dataset.before.split(",").map(Number);
            const after = flow.dataset.after.split(",").map(Number);
            const shift = Number(inspector.dataset.shift);
            const activeIndexes = side === "+" ? [0, 1] : [2, 3];
            const inactiveIndexes = [0, 1, 2, 3].filter((index) => !activeIndexes.includes(index));
            if (!activeIndexes.every((index) => after[index] === (((before[index] - 1) ^ shift) + 1)) || !inactiveIndexes.every((index) => after[index] === before[index])) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-shift-vs-flow", side, shift, before, after });
            const shownActive = [...inspector.querySelectorAll(".band-face-flow .neighbor-mini-figure:first-child .neighbor-mini-edge.active")].map((node) => node.dataset.side).sort();
            const expectedActive = (side === "+" ? ["W", "N"] : ["S", "E"]).sort();
            if (JSON.stringify(shownActive) !== JSON.stringify(expectedActive)) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-active-sides", side, shownActive, expectedActive });
            const constraints = [...inspector.querySelectorAll(".band-constraint-pairs > span")].map((node) => ({
              source: node.dataset.source.split(",").map(Number),
              target: node.dataset.target.split(",").map(Number),
            }));
            const works = (candidate) => constraints.every(({ source, target }) => {
              const shifted = source.map((value) => ((value - 1) ^ candidate) + 1).sort();
              return JSON.stringify(shifted) === JSON.stringify([...target].sort());
            });
            const candidateRows = [...inspector.querySelectorAll(".band-candidate")];
            if (!candidateRows.every((node) => works(Number(node.dataset.candidateShift)) === (node.dataset.valid === "true"))) failures.push({ n, sample, frame: kinds.length - 1, reason: "band-candidate-evidence" });
          }
        }
        if (document.querySelector("#nextButton").disabled) break;
        document.querySelector("#nextButton").click();
      }
      const expectedFrames = n <= 2 ? 5 : 2 * n + 1 + 4 * Math.max(0, n - 3);
      if (kinds.length !== expectedFrames) failures.push({ n, sample, reason: "length", expectedFrames, kinds });
    }
  }
  return failures;
})()`);
assert.deepEqual(randomStageSweep, []);

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
assert.match(invalid.status, /중복/);
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
assert.match(restored.status, /칸 OK/);
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
assert.match(explained.summary, /한 칸 표/);
assert.match(explained.summary, /이웃과 맞추기/);
assert.doesNotMatch(explained.summary, /α|diamond|Φ/);
assert.match(explained.detail, /마지막으로/);

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

const keyboardAndEdgeFocus = await evaluate(`(() => {
  const key = (node, value, extra = {}) => node.dispatchEvent(new KeyboardEvent("keydown", {
    key: value, bubbles: true, cancelable: true, ...extra,
  }));
  const select = document.querySelector("#nSelect");
  select.value = "3";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  document.querySelector("#nextButton").click();
  document.querySelector("#nextButton").click();

  const summary = document.querySelector("#operationSummary");
  summary.focus();
  const summaryBefore = location.hash;
  key(summary, "ArrowRight");
  const summaryGuard = location.hash === summaryBefore;

  const targetEdge = document.querySelector('#targetGrid .edge-label[role="button"]');
  targetEdge.focus();
  const svgBefore = location.hash;
  key(targetEdge, "ArrowRight");
  const svgGuard = location.hash === svgBefore;

  document.querySelector("#resetButton").click();
  const liveBeforeFrame = document.querySelector("#a11yStatus").textContent;
  document.querySelector("#nextButton").click();
  const liveAfterFrame = document.querySelector("#a11yStatus").textContent;
  const frameLive = liveAfterFrame !== liveBeforeFrame
    && liveAfterFrame.includes(document.querySelector("#stepTitle").textContent.trim())
    && liveAfterFrame.includes(document.querySelector("#operationBadge").textContent.trim());
  document.querySelector("#resetButton").click();
  document.querySelector("#editButton").click();
  let sourceEdge = document.querySelector('#sourceGrid .edge-label[role="button"]');
  const edgeKey = sourceEdge.dataset.edgeKey;
  sourceEdge.scrollIntoView({ block: "center" });
  const sourceScroll = scrollY;
  sourceEdge.focus();
  key(sourceEdge, "Enter");
  const focusAfterSelect = document.activeElement?.dataset.edgeKey === edgeKey;
  const noJumpAfterSelect = Math.abs(scrollY - sourceScroll) <= 1;
  sourceEdge = document.activeElement;
  const beforeDigit = sourceEdge.querySelector("text").textContent;
  const nextDigit = beforeDigit === "1" ? "2" : "1";
  key(sourceEdge, nextDigit);
  const focusedAfterValue = document.activeElement?.dataset.edgeKey === edgeKey;
  const afterDigit = document.querySelector('#sourceGrid .edge-label[data-edge-key="' + edgeKey + '"] text')?.textContent;
  key(document.activeElement, beforeDigit);
  const restoredDigit = document.querySelector('#sourceGrid .edge-label[data-edge-key="' + edgeKey + '"] text')?.textContent;
  const palette = document.querySelector('#edgeEditor [data-edge-value="' + (Number(beforeDigit) - 1) + '"]');
  palette.focus();
  palette.click();
  const paletteKeepsFocus = document.activeElement === palette;
  document.querySelector("#editButton").click();
  const editingClosed = document.querySelector("#edgeEditor").hidden;
  return {
    summaryGuard, svgGuard, focusAfterSelect, focusedAfterValue,
    noJumpAfterSelect, frameLive,
    beforeDigit, nextDigit, afterDigit, restoredDigit, paletteKeepsFocus, editingClosed,
    restoredStatus: document.querySelector("#sourceCheck").textContent,
  };
})()`);
assert.deepEqual(
  {
    summaryGuard: keyboardAndEdgeFocus.summaryGuard,
    svgGuard: keyboardAndEdgeFocus.svgGuard,
    focusAfterSelect: keyboardAndEdgeFocus.focusAfterSelect,
    focusedAfterValue: keyboardAndEdgeFocus.focusedAfterValue,
    noJumpAfterSelect: keyboardAndEdgeFocus.noJumpAfterSelect,
    frameLive: keyboardAndEdgeFocus.frameLive,
    paletteKeepsFocus: keyboardAndEdgeFocus.paletteKeepsFocus,
    editingClosed: keyboardAndEdgeFocus.editingClosed,
  },
  {
    summaryGuard: true, svgGuard: true,
    focusAfterSelect: true, focusedAfterValue: true, noJumpAfterSelect: true,
    frameLive: true, paletteKeepsFocus: true, editingClosed: true,
  },
);
assert.equal(keyboardAndEdgeFocus.afterDigit, keyboardAndEdgeFocus.nextDigit);
assert.equal(keyboardAndEdgeFocus.restoredDigit, keyboardAndEdgeFocus.beforeDigit);
assert.match(keyboardAndEdgeFocus.restoredStatus, /칸 OK/);

const bandFocusLive = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "6";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let guard = 0; guard < 50; guard += 1) {
    const stage = document.querySelector("#stageExplainer");
    if (stage.dataset.kind === "band" && stage.dataset.side === "+" && stage.dataset.width === "5") break;
    document.querySelector("#nextButton").click();
  }
  const live = document.querySelector("#a11yStatus");
  const liveAttrs = {
    role: live?.getAttribute("role"), mode: live?.getAttribute("aria-live"), atomic: live?.getAttribute("aria-atomic"),
  };
  const liveStyle = getComputedStyle(live);
  const step2 = document.querySelector('[data-band-step="2"]');
  step2.scrollIntoView({ block: "center" });
  step2.focus({ preventScroll: true });
  const stepScroll = scrollY;
  const liveBeforeStep = live.textContent;
  step2.click();
  const stepFocus = document.activeElement?.dataset.bandStep === "2";
  const stepNoJump = Math.abs(scrollY - stepScroll) <= 1;
  const stepLive = live.textContent;
  const face = [...document.querySelectorAll('.band-map-face.new:not(:disabled)')]
    .find((node) => node.getAttribute("aria-pressed") !== "true");
  const faceKey = face.dataset.bandFace;
  const faceLabel = face.querySelector(":scope > span").textContent.trim();
  face.focus({ preventScroll: true });
  const faceScroll = scrollY;
  const liveBeforeFace = live.textContent;
  face.click();
  return {
    liveAttrs,
    liveDisplay: liveStyle.display,
    liveVisibility: liveStyle.visibility,
    stepFocus,
    stepNoJump,
    stepLiveChanged: stepLive !== liveBeforeStep,
    stepLive,
    faceFocus: document.activeElement?.dataset.bandFace === faceKey,
    faceNoJump: Math.abs(scrollY - faceScroll) <= 1,
    faceLiveChanged: live.textContent !== liveBeforeFace,
    faceLive: live.textContent,
    faceLabel,
    selectedPressed: document.activeElement?.getAttribute("aria-pressed"),
    tabRoles: document.querySelectorAll('#stepTrack [role="tab"]').length,
    currentGlobalSteps: document.querySelectorAll('#stepTrack [aria-current="step"]').length,
  };
})()`);
assert.deepEqual(bandFocusLive.liveAttrs, { role: "status", mode: "polite", atomic: "true" });
assert.notEqual(bandFocusLive.liveDisplay, "none");
assert.notEqual(bandFocusLive.liveVisibility, "hidden");
assert.equal(bandFocusLive.stepFocus, true);
assert.equal(bandFocusLive.stepNoJump, true);
assert.equal(bandFocusLive.stepLiveChanged, true);
assert.match(bandFocusLive.stepLive, /새 5칸 붙이기|②/);
assert.equal(bandFocusLive.faceFocus, true);
assert.equal(bandFocusLive.faceNoJump, true);
assert.equal(bandFocusLive.faceLiveChanged, true);
assert(bandFocusLive.faceLive.includes(bandFocusLive.faceLabel), JSON.stringify(bandFocusLive));
assert.equal(bandFocusLive.selectedPressed, "true");
assert.equal(bandFocusLive.tabRoles, 0);
assert.equal(bandFocusLive.currentGlobalSteps, 1);

await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
const mobileNeighborLayout = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "3";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 3; index += 1) document.querySelector("#nextButton").click();
  const panel = document.querySelector("#neighborExplainer");
  const panelRect = panel.getBoundingClientRect();
  const overflow = [...panel.querySelectorAll(".neighbor-rule-evidence, .neighbor-rule-evidence > header, .neighbor-rule-evidence .neighbor-rule-table, .neighbor-simple-steps, .neighbor-read-row, .neighbor-face-pair, .neighbor-chosen-change, .neighbor-result-row, .neighbor-face-change, .neighbor-mini-figure, .neighbor-mini-face, .neighbor-a-complete-flow, .neighbor-face-cluster, .neighbor-cluster-figure, .neighbor-cluster-note, .neighbor-extra-details")]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
    }).map((node) => node.className);
  return {
    hidden: panel.hidden,
    extraClosed: !panel.querySelector(".neighbor-extra-details").open,
    evidenceVisible: panel.querySelector(".neighbor-rule-evidence").getClientRects().length > 0,
    panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
    overflow,
    copy: panel.textContent.replace(/\\s+/g, " ").trim(),
  };
})()`);
assert.equal(mobileNeighborLayout.hidden, false);
assert.equal(mobileNeighborLayout.extraClosed, true);
assert.equal(mobileNeighborLayout.evidenceVisible, true);
assert.equal(mobileNeighborLayout.panelOverflow, false);
assert.deepEqual(mobileNeighborLayout.overflow, []);
assert.doesNotMatch(mobileNeighborLayout.copy, /X·Y·Z|[XYZ] 교환|종류 I|종류 II|종류 III/);

const mobileStageLayout = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "4";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 8; index += 1) document.querySelector("#nextButton").click();
  const stageState = document.querySelector("#stageExplainer");
  const stage = document.querySelector("#neighborExplainer");
  const body = stage;
  const stageRect = stage.getBoundingClientRect();
  const overflow = [...stage.querySelectorAll(".neighbor-rule-evidence, .neighbor-rule-table, .neighbor-simple-steps, .neighbor-a-algorithm, .neighbor-a-phase, .neighbor-phase-flow, .southeast-cluster")]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < stageRect.left - 1 || rect.right > stageRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
    }).map((node) => node.className);
  return {
    kind: stageState.dataset.kind,
    hidden: stage.hidden,
    stageOverflow: stage.scrollWidth > stage.clientWidth + 1,
    bodyOverflow: body.scrollWidth > body.clientWidth + 1,
    overflow,
  };
})()`);
assert.deepEqual(mobileStageLayout, {
  kind: "minus-second",
  hidden: false,
  stageOverflow: false,
  bodyOverflow: false,
  overflow: [],
});

const mobileBandLayout = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "6";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let index = 0; index < 11; index += 1) document.querySelector("#nextButton").click();
  const stage = document.querySelector("#stageExplainer");
  const body = document.querySelector("#stageBody");
  const stageRect = stage.getBoundingClientRect();
  const readOverflow = () => [...stage.querySelectorAll(".band-order, .band-order-card, .band-workspace, .band-map-card, .band-block-map, .band-map-face, .band-inspector, .band-face-flow, .band-applied-swap, .band-rule-evidence, .band-constraint-pairs, .band-candidate-list, .band-candidate, .band-result-sentence, .band-visit-summary, .band-visit-groups, .band-visit-group, .band-full-history, .band-finish")]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < stageRect.left - 1 || rect.right > stageRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
    }).map((node) => node.className);
  const newOverflow = readOverflow();
  body.querySelector('[data-band-step="1"]').click();
  const oldButtons = [...body.querySelectorAll('.band-map-face[data-role="old"]')];
  oldButtons.sort((left, right) => Number(right.dataset.visits) - Number(left.dataset.visits));
  oldButtons[0].click();
  const oldInspector = body.querySelector(".band-inspector.old");
  const fullHistory = oldInspector.querySelector(".band-full-history");
  fullHistory.open = true;
  const visitTrack = fullHistory.querySelector(".band-visit-track");
  const trackScrollable = visitTrack.scrollWidth > visitTrack.clientWidth + 1;
  visitTrack.scrollLeft = visitTrack.scrollWidth;
  const trackRect = visitTrack.getBoundingClientRect();
  const lastVisitRect = visitTrack.lastElementChild.getBoundingClientRect();
  const lastVisitReachable = lastVisitRect.left >= trackRect.left - 1 && lastVisitRect.right <= trackRect.right + 1;
  const oldOverflow = readOverflow();
  return {
    kind: stage.dataset.kind,
    side: stage.dataset.side,
    width: stage.dataset.width,
    mapCount: body.querySelectorAll(".band-map-face").length,
    newCount: body.querySelectorAll('.band-map-face[data-role="new"]').length,
    selectedOldVisits: Number(oldInspector.dataset.visits),
    visitCards: oldInspector.querySelectorAll(".band-visit").length,
    detailsOpen: fullHistory.open,
    trackScrollable,
    lastVisitReachable,
    stageOverflow: stage.scrollWidth > stage.clientWidth + 1,
    bodyOverflow: body.scrollWidth > body.clientWidth + 1,
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    newOverflow,
    oldOverflow,
    copy: stage.textContent.replace(/\\s+/g, " ").trim(),
  };
})()`);
assert.deepEqual(
  { kind: mobileBandLayout.kind, side: mobileBandLayout.side, width: mobileBandLayout.width },
  { kind: "band", side: "+", width: "5" },
);
assert.equal(mobileBandLayout.mapCount, 15);
assert.equal(mobileBandLayout.newCount, 5);
assert(mobileBandLayout.selectedOldVisits > 1, JSON.stringify(mobileBandLayout));
assert.equal(mobileBandLayout.visitCards, mobileBandLayout.selectedOldVisits);
assert.equal(mobileBandLayout.detailsOpen, true);
assert(mobileBandLayout.trackScrollable, JSON.stringify(mobileBandLayout));
assert(mobileBandLayout.lastVisitReachable, JSON.stringify(mobileBandLayout));
assert.equal(mobileBandLayout.stageOverflow, false);
assert.equal(mobileBandLayout.bodyOverflow, false);
assert.equal(mobileBandLayout.pageOverflow, false);
assert.deepEqual(mobileBandLayout.newOverflow, []);
assert.deepEqual(mobileBandLayout.oldOverflow, []);
assert.doesNotMatch(mobileBandLayout.copy, /undefined|NaN|alpha|diamond|proof|β|Φ|GF\(2\)|X·Y·Z/i);

await send("Emulation.setDeviceMetricsOverride", {
  width: 320,
  height: 568,
  deviceScaleFactor: 1,
  mobile: true,
});
const mobile320 = await evaluate(`(() => {
  const select = document.querySelector("#nSelect");
  select.value = "6";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#resetButton").click();
  for (let guard = 0; guard < 50; guard += 1) {
    const current = document.querySelector("#stageExplainer");
    if (current.dataset.kind === "band" && current.dataset.side === "+" && current.dataset.width === "5") break;
    document.querySelector("#nextButton").click();
  }
  document.querySelector('[data-band-step="2"]').click();
  const stage = document.querySelector("#stageExplainer");
  const body = document.querySelector("#stageBody");
  const map = document.querySelector(".band-block-map");
  const card = document.querySelector(".band-map-card");
  const stageRect = stage.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const offenders = [...stage.querySelectorAll(".band-order, .band-order-card, .band-workspace, .band-map-card, .band-block-map, .band-map-face, .band-inspector, .band-face-flow, .band-applied-swap, .band-rule-evidence, .band-candidate, .band-finish")]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < stageRect.left - 1 || rect.right > stageRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
    }).map((node) => node.className);

  const transport = document.querySelector(".transport");
  const transportRect = transport.getBoundingClientRect();
  const transportStyle = getComputedStyle(transport);
  const buttonRects = [...transport.querySelectorAll("button")].map((node) => node.getBoundingClientRect());
  const visualText = (node) => node.textContent + " " + getComputedStyle(node, "::before").content + " " + getComputedStyle(node, "::after").content;
  const bottomGap = innerHeight - transportRect.bottom;
  const px = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
  const fonts = {
    body: px(".band-result-sentence"),
    helper: px(".band-rule-evidence > header p"),
    label: px(".band-order-card span"),
    candidate: px(".band-candidate > small"),
  };
  const mapStatuses = [...document.querySelectorAll(".band-map-status")];
  const statusVisible = mapStatuses.every((node) => getComputedStyle(node).display !== "none"
    && getComputedStyle(node.querySelector("b")).display !== "none");
  window.scrollTo(0, document.documentElement.scrollHeight);
  const transportAfterScroll = transport.getBoundingClientRect();
  const footer = document.querySelector("footer").getBoundingClientRect();
  const nextDisabled = document.querySelector("#nextButton").disabled;
  const nextRect = document.querySelector("#nextButton").getBoundingClientRect();
  const nextHitTarget = Boolean(document.elementFromPoint(
    nextRect.left + nextRect.width / 2,
    nextRect.top + nextRect.height / 2,
  )?.closest("#nextButton"));
  return {
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    stageOverflow: stage.scrollWidth > stage.clientWidth + 1,
    bodyOverflow: body.scrollWidth > body.clientWidth + 1,
    mapInside: mapRect.left >= cardRect.left - 1 && mapRect.right <= cardRect.right + 1,
    offenders,
    transportPosition: transportStyle.position,
    transportInside: transportRect.left >= 7 && transportRect.right <= innerWidth - 7 && bottomGap >= 0 && bottomGap <= 20,
    transportStillFixed: Math.abs((innerHeight - transportAfterScroll.bottom) - bottomGap) <= 1,
    touchTargets: buttonRects.every((rect) => rect.width >= 44 && rect.height >= 44),
    buttonsInside: buttonRects.every((rect) => rect.left >= transportRect.left - 1 && rect.right <= transportRect.right + 1 && rect.left >= 0 && rect.right <= innerWidth),
    footerClear: footer.bottom <= transportAfterScroll.top + 1,
    prevVisual: visualText(document.querySelector("#previousButton")),
    nextVisual: visualText(document.querySelector("#nextButton")),
    nextDisabled,
    nextHitTarget,
    fonts,
    statusVisible,
  };
})()`);
assert.equal(mobile320.pageOverflow, false, JSON.stringify(mobile320));
assert.equal(mobile320.stageOverflow, false, JSON.stringify(mobile320));
assert.equal(mobile320.bodyOverflow, false, JSON.stringify(mobile320));
assert.equal(mobile320.mapInside, true, JSON.stringify(mobile320));
assert.deepEqual(mobile320.offenders, []);
assert.equal(mobile320.transportPosition, "fixed");
assert.equal(mobile320.transportInside, true);
assert.equal(mobile320.transportStillFixed, true);
assert.equal(mobile320.touchTargets, true);
assert.equal(mobile320.buttonsInside, true);
assert.equal(mobile320.footerClear, true);
assert.match(mobile320.prevVisual, /이전/);
assert.match(mobile320.nextVisual, /다음/);
assert.equal(mobile320.nextDisabled, false);
assert.equal(mobile320.nextHitTarget, true);
assert.equal(mobile320.statusVisible, true);
assert(mobile320.fonts.body >= 12.9, JSON.stringify(mobile320.fonts));
assert(mobile320.fonts.helper >= 11.9, JSON.stringify(mobile320.fonts));
assert(mobile320.fonts.label >= 10.9, JSON.stringify(mobile320.fonts));
assert(mobile320.fonts.candidate >= 10.9, JSON.stringify(mobile320.fonts));
await send("Emulation.clearDeviceMetricsOverride");

socket.close();
console.log("browser smoke passed: frame-aware stage explanations, edit recovery, and edge-change details");
