import { formatLabel } from "./bijection.mjs";
import {
  alphaBasePair,
  cloneGrid,
  createGrid,
  decodeDraftGrid,
  encodeGrid,
  faceTuple,
  gridsEqual,
  randomEGrid,
  replayHalfTrace,
  strandType,
  transformDtoE,
  transformEtoD,
  validateD,
  validateE,
  validatePartialE,
  writeHalf,
} from "./grid-bijection.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const PHASES = [
  { id: "input", short: "입력" },
  { id: "interface", short: "대각 고정" },
  { id: "plus", short: "왼쪽 위" },
  { id: "minus", short: "오른쪽 아래" },
  { id: "complete", short: "완성" },
];

const CHECKS = [
  ["source", "입력이 Eₙ: 모든 n² face proper", 0],
  ["interface", "대각 face의 4n edge를 interface I로 고정", 1],
  ["factor", "Eₙ(I)=B⁺(η⁺)×B⁻(η⁻)로 읽을 수 있음", 1],
  ["plus", "β̃⁺가 northwest B⁺를 A⁺로 변환", 2],
  ["minus", "β̃⁻가 southeast B⁻를 A⁻로 변환", 3],
  ["target", "출력이 Dₙ: diagonal proper / off-diagonal strand", 4],
  ["fixed", "모든 diagonal-interface edge가 pointwise 불변", 4],
  ["inverse", "명시적 Dₙ→Eₙ 역변환이 입력을 복원", 4],
];

const state = {
  source: loadGrid() ?? randomEGrid(3),
  result: null,
  roundTripOk: false,
  inputValidation: null,
  frames: [],
  frameIndex: loadFrameIndex(),
  diamondIndex: 0,
  editing: loadEditMode(),
  editSnapshot: null,
  selectedEdge: null,
  explainedEdge: null,
  timer: null,
};

const dom = Object.fromEntries(
  [
    "liveStatus", "nSelect", "randomButton", "editButton", "blankButton", "cancelEditButton",
    "copyLinkButton", "resetButton", "previousButton",
    "playButton", "nextButton", "stepCounter", "stepTitle", "stepDescription", "stepTrack",
    "processMeta", "operationBadge", "changeBadge", "operationDetails", "operationSummary",
    "operationDetail", "sourceGrid", "targetGrid", "sourceTitle", "edgeEditor", "selectedEdgeLabel",
    "sourceCheck", "targetCheck", "targetEyebrow", "targetTitle",
    "cornerStatus", "cornerFlow", "cornerInput", "cornerLookup", "cornerFirstOutput", "cornerShape",
    "cornerExplanation",
    "transformName", "transformNote", "interfaceTuples", "etaPlus", "etaMinus", "plusTraceCount",
    "minusTraceCount", "plusRows", "minusRows", "previousDiamond", "nextDiamond", "diamondCounter",
    "diamondDetail", "checkGrid", "resultBadge", "configurationId", "toast",
  ].map((id) => [id, document.getElementById(id)]),
);

initialize();

function initialize() {
  buildStepper();
  bindEvents();
  recompute();
}

function bindEvents() {
  dom.nSelect.addEventListener("change", () => replaceSource(randomEGrid(Number(dom.nSelect.value)), { editing: false }));
  dom.randomButton.addEventListener("click", () => {
    replaceSource(randomEGrid(Number(dom.nSelect.value)), {
      editing: state.editing,
      preserveSnapshot: state.editing,
    });
    showToast("새 전체 Eₙ labeling과 그 deterministic image Dₙ을 만들었습니다.");
  });
  dom.editButton.addEventListener("click", toggleEditing);
  dom.blankButton.addEventListener("click", () => {
    state.selectedEdge = null;
    replaceSource(createGrid(Number(dom.nSelect.value)), { editing: true, preserveSnapshot: true });
  });
  dom.cancelEditButton.addEventListener("click", cancelEditing);
  dom.edgeEditor.querySelectorAll("[data-edge-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.edgeValue === "" ? null : Number(button.dataset.edgeValue);
      setSelectedEdgeValue(value);
    });
  });
  dom.copyLinkButton.addEventListener("click", copyLink);
  dom.resetButton.addEventListener("click", () => {
    stopAutoplay();
    state.frameIndex = 0;
    render();
  });
  dom.previousButton.addEventListener("click", () => moveFrame(-1));
  dom.nextButton.addEventListener("click", () => moveFrame(1));
  dom.playButton.addEventListener("click", toggleAutoplay);
  dom.previousDiamond.addEventListener("click", () => changeDiamond(-1));
  dom.nextDiamond.addEventListener("click", () => changeDiamond(1));
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    if (state.editing) {
      if (/^[1-4]$/.test(event.key)) {
        setSelectedEdgeValue(Number(event.key) - 1);
        event.preventDefault();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        setSelectedEdgeValue(null);
        event.preventDefault();
      } else if (event.key === "Escape") {
        state.selectedEdge = null;
        render();
      }
      return;
    }
    if (event.key === "ArrowLeft") moveFrame(-1);
    if (event.key === "ArrowRight") moveFrame(1);
  });
}

function buildStepper() {
  dom.stepTrack.replaceChildren();
  PHASES.forEach(({ id, short }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-dot";
    button.setAttribute("role", "tab");
    button.innerHTML = `<b>${index + 1}</b><span>${short}</span>`;
    button.addEventListener("click", () => {
      stopAutoplay();
      const frameIndex = state.frames.findIndex((frame) => frame.phase === id);
      if (frameIndex >= 0) setFrame(frameIndex);
    });
    dom.stepTrack.append(button);
  });
}

function replaceSource(source, { editing = false, preserveSnapshot = false } = {}) {
  stopAutoplay();
  state.source = source;
  state.editing = editing;
  if (!preserveSnapshot) state.editSnapshot = null;
  state.frameIndex = 0;
  state.diamondIndex = 0;
  state.explainedEdge = null;
  recompute();
}

function toggleEditing() {
  stopAutoplay();
  if (!state.editing) {
    state.editSnapshot = cloneGrid(state.source);
    state.editing = true;
    state.frameIndex = 0;
    state.selectedEdge = null;
    render();
    return;
  }
  if (!state.inputValidation.ok) {
    showToast("모든 edge를 입력하고 각 칸의 네 숫자가 서로 달라야 입력을 완료할 수 있습니다.");
    return;
  }
  state.editing = false;
  state.editSnapshot = null;
  state.selectedEdge = null;
  render();
}

function cancelEditing() {
  if (!state.editSnapshot) {
    if (!state.inputValidation.ok) {
      showToast("돌아갈 원본이 없는 미완성 입력입니다. 값을 완성하거나 랜덤 Eₙ을 만든 뒤 편집을 종료하세요.");
      return;
    }
    state.editing = false;
    state.selectedEdge = null;
    render();
    return;
  }
  const restored = cloneGrid(state.editSnapshot);
  state.editSnapshot = null;
  state.selectedEdge = null;
  replaceSource(restored, { editing: false });
}

function selectEdge(key) {
  if (!state.editing) return;
  state.selectedEdge = key;
  render();
}

function setSelectedEdgeValue(value) {
  if (!state.editing || !state.selectedEdge) return;
  const [kind, yText, xText] = state.selectedEdge.split(":");
  const y = Number(yText);
  const x = Number(xText);
  state.source[kind][y][x] = value;
  state.frameIndex = 0;
  state.explainedEdge = null;
  recompute();
}

function recompute() {
  state.inputValidation = validatePartialE(state.source);
  if (!state.inputValidation.ok) {
    state.result = null;
    state.roundTripOk = false;
    state.frames = [buildInvalidInputFrame(state.source, state.inputValidation)];
    state.frameIndex = 0;
    state.editing = true;
    render();
    return;
  }
  state.result = transformEtoD(state.source);
  state.roundTripOk = gridsEqual(transformDtoE(state.result.target), state.source);
  state.frames = buildProcessFrames(state.source, state.result);
  state.frameIndex = Math.min(state.frameIndex, state.frames.length - 1);
  render();
}

function buildInvalidInputFrame(source, validation) {
  const missing = validation.totalEdges - validation.assignedEdges;
  const invalid = validation.invalidFaces.length;
  const description = invalid
    ? `${invalid}칸에서 같은 숫자가 중복됩니다. 붉게 표시된 칸을 고치면 변환을 시작할 수 있습니다.`
    : `${missing}개 edge가 아직 비어 있습니다. 모든 칸이 1,2,3,4를 한 번씩 사용하도록 입력하세요.`;
  return makeFrame({
    phase: "input",
    grid: cloneGrid(source),
    visibleEdges: new Set(),
    title: invalid ? "Eₙ 입력 수정 필요" : "Eₙ 값 직접 입력",
    description,
    operation: invalid ? `${invalid}칸 색 중복` : `${validation.assignedEdges}/${validation.totalEdges}개 edge 입력`,
    change: "입력이 완성되면 변환 시작",
    mapLabel: "입력",
    mapNote: "변환 대기",
  });
}

function moveFrame(delta) {
  stopAutoplay();
  setFrame(state.frameIndex + delta);
}

function setFrame(value) {
  if (value !== state.frameIndex) state.explainedEdge = null;
  state.frameIndex = Math.max(0, Math.min(state.frames.length - 1, value));
  render();
}

function toggleAutoplay() {
  if (state.timer) {
    stopAutoplay();
    return;
  }
  if (state.frameIndex === state.frames.length - 1) state.frameIndex = 0;
  dom.playButton.textContent = "일시 정지";
  render();
  state.timer = window.setInterval(() => {
    if (state.frameIndex === state.frames.length - 1) {
      stopAutoplay();
      return;
    }
    state.frameIndex += 1;
    state.explainedEdge = null;
    render();
  }, autoplayDelay(state.source.n));
}

function stopAutoplay() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  dom.playButton.textContent = "자동 재생";
}

function autoplayDelay(n) {
  return n >= 5 ? 850 : 1050;
}

function buildHalfTraceSegments(part, sign, n) {
  const replay = replayHalfTrace(part.before, part.trace);
  const replayByEvent = new Map(replay.frames.map((frame) => [frame.event, frame]));
  const segments = [];
  let primitives = [];
  for (const event of part.trace) {
    if (event.type === "alpha-base" || event.type === "diamond") {
      const replayFrame = replayByEvent.get(event);
      primitives.push({
        event,
        mutations: primitiveEdgeMutations(replayFrame.updates, sign, n),
      });
    }
    if (event.type === "beta-complete") {
      segments.push({ checkpoint: event, primitives });
      primitives = [];
    }
  }
  return segments;
}

function primitiveEdgeMutations(updates, sign, n) {
  const mutations = [];
  updates.forEach(({ rowOffset, source, target }) => {
    source.forEach((entry, index) => {
      const keys = halfEntryEdgeKeys(n, sign, rowOffset, index);
      if (entry.l !== target[index].l) mutations.push({ key: keys.l, oldValue: entry.l, newValue: target[index].l });
      if (entry.v !== target[index].v) mutations.push({ key: keys.v, oldValue: entry.v, newValue: target[index].v });
    });
  });
  return mutations;
}

function halfEntryEdgeKeys(n, sign, rowOffset, index) {
  const t = rowOffset + 1;
  if (sign === "+") {
    const x = index;
    const y = index + t;
    return { l: edgeKey("v", y, x), v: edgeKey("h", y + 1, x) };
  }
  const x = index + t;
  const y = index;
  return { l: edgeKey("h", y, x), v: edgeKey("v", y, x + 1) };
}

function buildProcessFrames(source, result) {
  const n = source.n;
  const interfaceEdges = interfaceEdgeKeys(n);
  const frames = [
    makeFrame({
      phase: "input",
      grid: cloneGrid(source),
      visibleEdges: new Set(),
      title: "Eₙ 입력",
      description: "왼쪽의 모든 칸은 네 변에 1,2,3,4를 한 번씩 사용합니다. 오른쪽에 결과를 한 단계씩 만듭니다.",
      operation: "입력 확인",
      change: "출력 edge 0개",
      mapLabel: "입력",
      mapNote: "작업 전",
    }),
    makeFrame({
      phase: "interface",
      grid: cloneGrid(source),
      visibleEdges: interfaceEdges,
      title: "대각선 칸 그대로 복사",
      description: `대각선 위 ${n}칸의 edge ${4 * n}개를 오른쪽에 그대로 복사합니다. 이 edge들은 끝까지 바뀌지 않습니다.`,
      operation: "대각선 칸 복사",
      change: `${4 * n}개 edge 그대로 유지`,
      mapLabel: "대각 고정",
      mapNote: "끝까지 그대로",
    }),
  ];

  const workGrid = cloneGrid(source);
  const plusRows = cloneOrientationRows(result.plus.before);
  const plusSegments = buildHalfTraceSegments(result.plus, "+", n);

  if (!plusSegments.length) {
    frames.push(makeEmptyHalfFrame("+", workGrid, interfaceEdges));
  } else {
    let previousVisible = new Set(interfaceEdges);
    plusSegments.forEach((segment, index) => {
      const event = segment.checkpoint;
      const previous = cloneGrid(workGrid);
      replaceRowsAt(plusRows, event.rowOffset, event.targetRows);
      writeHalf(workGrid, "+", plusRows);
      const visibleEdges = new Set(interfaceEdges);
      addHalfFaceEdges(visibleEdges, n, "+", event.rowOffset);
      frames.push(makeBetaFrame({
        sign: "+",
        event,
        index,
        total: plusSegments.length,
        grid: workGrid,
        previous,
        previousVisible,
        visibleEdges,
        primitives: segment.primitives,
        n,
      }));
      previousVisible = visibleEdges;
    });
  }

  const plusVisible = new Set(interfaceEdges);
  addHalfFaceEdges(plusVisible, n, "+", 0);
  const minusRows = cloneOrientationRows(result.minus.before);
  const minusSegments = buildHalfTraceSegments(result.minus, "-", n);

  if (!minusSegments.length) {
    frames.push(makeEmptyHalfFrame("-", workGrid, plusVisible));
  } else {
    let previousVisible = new Set(plusVisible);
    minusSegments.forEach((segment, index) => {
      const event = segment.checkpoint;
      const previous = cloneGrid(workGrid);
      replaceRowsAt(minusRows, event.rowOffset, event.targetRows);
      writeHalf(workGrid, "-", minusRows);
      const visibleEdges = new Set(plusVisible);
      addHalfFaceEdges(visibleEdges, n, "-", event.rowOffset);
      frames.push(makeBetaFrame({
        sign: "-",
        event,
        index,
        total: minusSegments.length,
        grid: workGrid,
        previous,
        previousVisible,
        visibleEdges,
        primitives: segment.primitives,
        n,
      }));
      previousVisible = visibleEdges;
    });
  }

  frames.push(makeFrame({
    phase: "complete",
    grid: cloneGrid(result.target),
    visibleEdges: allGridEdgeKeys(n),
    title: "Dₙ 완성",
    description: "오른쪽의 모든 칸이 완성되었습니다. 대각선 칸은 그대로이고, 나머지 칸에는 두 선이 연결되어 있습니다.",
    operation: "모든 칸 완성",
    change: "입력으로 되돌아가는 것도 확인",
    mapLabel: "완성",
    mapNote: "양방향 확인",
  }));

  return frames;
}

function makeFrame(frame) {
  return {
    activeSide: null,
    activeRows: [],
    activeEdges: new Set(),
    activeBlockEdges: new Set(),
    newBandEdges: new Set(),
    readjustedEdges: new Set(),
    previousGrid: null,
    primitives: [],
    edgeReasons: new Map(),
    ...frame,
    grid: cloneGrid(frame.grid),
    visibleEdges: new Set(frame.visibleEdges),
  };
}

function makeEmptyHalfFrame(sign, grid, visibleEdges) {
  const northwest = sign === "+";
  return makeFrame({
    phase: northwest ? "plus" : "minus",
    grid,
    visibleEdges,
    title: `${northwest ? "왼쪽 위" : "오른쪽 아래"} 영역 만들기`,
    description: "n=1에는 대각선 밖의 칸이 없어서 추가로 바꿀 것이 없습니다.",
    operation: "바꿀 칸 없음",
    change: "변경된 edge 0개",
    mapLabel: "그대로",
    mapNote: "빈 영역",
  });
}

function makeBetaFrame({ sign, event, index, total, grid, previous, previousVisible, visibleEdges, primitives, n }) {
  const northwest = sign === "+";
  const sideName = northwest ? "왼쪽 위" : "오른쪽 아래";
  const faceCount = event.width * (event.width + 1) / 2;
  const halfCount = n * (n - 1) / 2;
  const changedEdges = diffGridEdges(previous, grid);
  const activeBlockEdges = halfBandEdgeKeys(n, sign, event.rowOffset);
  const newVisibleEdges = new Set([...visibleEdges].filter((key) => !previousVisible.has(key)));
  const newBandEdges = new Set([...changedEdges].filter((key) => !previousVisible.has(key)));
  const readjustedEdges = new Set([...changedEdges].filter((key) => previousVisible.has(key)));
  const edgeReasons = new Map();
  primitives.forEach((primitive, primitiveIndex) => {
    primitive.mutations.forEach((mutation) => {
      if (!changedEdges.has(mutation.key)) return;
      if (!edgeReasons.has(mutation.key)) edgeReasons.set(mutation.key, []);
      edgeReasons.get(mutation.key).push({ ...mutation, event: primitive.event, primitiveIndex });
    });
  });
  const last = index === total - 1;
  const description = event.width === 1
    ? `${sideName}의 바깥 모서리 한 칸을 위의 고정표로 먼저 만들었습니다.`
    : last
      ? `${sideName}의 ${halfCount}칸을 모두 만들었습니다. 대각선 칸은 바뀌지 않았습니다.`
      : `모서리 쪽 ${faceCount}칸을 만들었습니다. 새 칸과 edge를 공유하면 먼저 만든 칸도 다시 맞춥니다.`;

  return makeFrame({
    phase: northwest ? "plus" : "minus",
    grid,
    visibleEdges,
    activeSide: sign,
    activeRows: [event.rowOffset],
    activeEdges: changedEdges,
    activeBlockEdges,
    newBandEdges,
    readjustedEdges,
    previousGrid: previous,
    primitives,
    edgeReasons,
    title: `${sideName} 영역 만들기`,
    description,
    operation: `${sideName} · ${index + 1}/${total}번째 묶음`,
    change: `새로 보인 칸 ${event.width}개 · 새 edge ${newVisibleEdges.size}개 · 기존 edge ${readjustedEdges.size}개 다시 맞춤`,
    mapLabel: "한 칸씩",
    mapNote: "모서리부터 대각선으로",
  });
}

function cloneOrientationRows(rows) {
  return rows.map((row) => row.map(({ l, v }) => ({ l, v })));
}

function replaceRowsAt(rows, offset, replacements) {
  replacements.forEach((row, index) => {
    rows[offset + index] = cloneOrientationRows([row])[0];
  });
}

function edgeKey(kind, y, x) {
  return `${kind}:${y}:${x}`;
}

function gridFaceEdgeKeys(x, y) {
  return [edgeKey("v", y, x), edgeKey("h", y + 1, x), edgeKey("v", y, x + 1), edgeKey("h", y, x)];
}

function interfaceEdgeKeys(n) {
  const keys = new Set();
  for (let index = 0; index < n; index += 1) {
    gridFaceEdgeKeys(index, index).forEach((key) => keys.add(key));
  }
  return keys;
}

function allGridEdgeKeys(n) {
  const keys = new Set();
  for (let y = 0; y <= n; y += 1) for (let x = 0; x < n; x += 1) keys.add(edgeKey("h", y, x));
  for (let y = 0; y < n; y += 1) for (let x = 0; x <= n; x += 1) keys.add(edgeKey("v", y, x));
  return keys;
}

function addHalfFaceEdges(keys, n, sign, minimumRowOffset) {
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if ((sign === "+" && y <= x) || (sign === "-" && x <= y)) continue;
      if (Math.abs(y - x) - 1 < minimumRowOffset) continue;
      gridFaceEdgeKeys(x, y).forEach((key) => keys.add(key));
    }
  }
}

function halfBandEdgeKeys(n, sign, rowOffset) {
  const keys = new Set();
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if ((sign === "+" && y <= x) || (sign === "-" && x <= y)) continue;
      if (Math.abs(y - x) - 1 !== rowOffset) continue;
      gridFaceEdgeKeys(x, y).forEach((key) => keys.add(key));
    }
  }
  return keys;
}

function diffGridEdges(before, after) {
  const changed = new Set();
  for (let y = 0; y <= before.n; y += 1) {
    for (let x = 0; x < before.n; x += 1) {
      if (before.h[y][x] !== after.h[y][x]) changed.add(edgeKey("h", y, x));
    }
  }
  for (let y = 0; y < before.n; y += 1) {
    for (let x = 0; x <= before.n; x += 1) {
      if (before.v[y][x] !== after.v[y][x]) changed.add(edgeKey("v", y, x));
    }
  }
  return changed;
}

function render() {
  syncUrl();
  const n = state.source.n;
  const frame = state.frames[state.frameIndex];
  const phaseIndex = PHASES.findIndex(({ id }) => id === frame.phase);
  const complete = frame.phase === "complete";
  dom.nSelect.value = String(n);
  renderSourceStatus(n);
  renderEditor();
  renderTargetHeader(frame, n);

  dom.stepCounter.textContent = `${phaseIndex + 1} / ${PHASES.length}`;
  dom.stepTitle.textContent = frame.title;
  dom.stepDescription.textContent = frame.description;
  dom.operationBadge.textContent = frame.operation;
  dom.changeBadge.textContent = frame.change;
  [...dom.stepTrack.children].forEach((button, index) => {
    button.classList.toggle("active", index === phaseIndex);
    button.classList.toggle("done", index < phaseIndex);
    button.setAttribute("aria-selected", String(index === phaseIndex));
    button.disabled = index > 0 && (!state.result || state.editing);
  });

  dom.transformName.textContent = frame.mapLabel;
  dom.transformNote.textContent = frame.mapNote;

  renderGrid(dom.sourceGrid, state.source, { target: false, frame, phaseIndex });
  renderGrid(dom.targetGrid, frame.grid, { target: true, frame, phaseIndex });
  renderCornerExplanation();
  renderOperationDetails(frame);
  if (state.result) {
    renderInterface();
    renderHalves(phaseIndex);
    renderDiamondDetail();
    renderChecks(phaseIndex);
  } else {
    renderUnavailableDetails();
  }

  dom.previousButton.disabled = state.editing || state.frameIndex === 0;
  dom.nextButton.disabled = state.editing || !state.result || complete;
  dom.playButton.disabled = state.editing || !state.result;
  dom.resultBadge.textContent = state.result
    ? complete ? "Eₙ ↔ Dₙ 검증 완료" : "진행 중"
    : "입력 대기";
  dom.resultBadge.classList.toggle("complete", Boolean(state.result && complete));
  const validInput = state.inputValidation.ok;
  dom.liveStatus.innerHTML = complete
    ? `<span></span> 변환 완료 · 대각선 edge 유지`
    : validInput
      ? `<span></span> 입력 E<sub>n</sub> 유효`
      : `<span></span> 입력 E<sub>n</sub> 수정 필요`;
  dom.liveStatus.classList.toggle("invalid", !validInput);
  dom.configurationId.textContent = `구성 ID ${configurationId(state.source)}`;
}

function renderSourceStatus(n) {
  const validation = state.inputValidation;
  dom.sourceTitle.innerHTML = validation.ok
    ? `E<sub>${n}</sub> — 모든 칸 OK`
    : `E<sub>${n}</sub> — 입력 중`;
  if (validation.ok) {
    dom.sourceCheck.textContent = `${n * n} / ${n * n} 칸 OK`;
    dom.sourceCheck.classList.remove("invalid");
    return;
  }
  const missing = validation.totalEdges - validation.assignedEdges;
  dom.sourceCheck.textContent = validation.invalidFaces.length
    ? `${validation.invalidFaces.length}칸 색 중복`
    : `${missing}개 edge 미입력`;
  dom.sourceCheck.classList.add("invalid");
}

function renderEditor() {
  dom.editButton.textContent = state.editing ? "✓ 입력 완료" : "✎ 값 입력";
  dom.editButton.classList.toggle("editing", state.editing);
  dom.blankButton.hidden = !state.editing;
  dom.cancelEditButton.hidden = !state.editing;
  dom.cancelEditButton.disabled = state.editing && !state.editSnapshot && !state.inputValidation.ok;
  dom.cancelEditButton.title = dom.cancelEditButton.disabled ? "공유된 미완성 입력에는 돌아갈 원본이 없습니다." : "";
  dom.edgeEditor.hidden = !state.editing;
  const selected = state.selectedEdge;
  dom.selectedEdgeLabel.textContent = selected ? edgeDisplayName(selected) : "격자에서 edge를 선택하세요";
  dom.edgeEditor.querySelectorAll("[data-edge-value]").forEach((button) => {
    button.disabled = !selected;
  });
}

function renderCornerExplanation() {
  document.querySelectorAll(".pair-rule").forEach((row) => {
    row.classList.remove("current");
    row.removeAttribute("aria-current");
  });

  if (state.source.n < 2) {
    dom.cornerStatus.textContent = "n=1에는 대각선 밖의 맨 왼쪽 위 칸이 없습니다.";
    dom.cornerInput.textContent = "—";
    dom.cornerLookup.textContent = "—";
    dom.cornerFirstOutput.textContent = "—";
    dom.cornerShape.textContent = "n≥2에서 사용";
    dom.cornerExplanation.textContent = "n을 2 이상으로 바꾸면 현재 격자의 실제 계산을 보여줍니다.";
    dom.cornerFlow.classList.add("unavailable");
    return;
  }

  dom.cornerFlow.classList.remove("unavailable");
  const tuple = faceTuple(state.source, 0, state.source.n - 1);
  dom.cornerInput.innerHTML = cornerTupleHtml(tuple);
  const values = Object.values(tuple);
  const pairReady = tuple.W !== null && tuple.N !== null && tuple.W !== tuple.N;

  if (!pairReady) {
    dom.cornerStatus.textContent = "왼쪽·위 숫자를 서로 다르게 입력하면 표에서 바로 찾습니다.";
    dom.cornerLookup.textContent = "계산 대기";
    dom.cornerFirstOutput.textContent = "—";
    dom.cornerShape.textContent = "입력 대기";
    dom.cornerExplanation.textContent = "먼저 맨 왼쪽 위 칸의 왼쪽·위 edge를 완성하세요.";
    return;
  }

  const mapped = alphaBasePair(tuple.W, tuple.N);
  const pairKey = `${tuple.W}-${tuple.N}`;
  document.querySelectorAll(".pair-rule").forEach((row) => {
    const current = row.dataset.cornerPairs.split(",").includes(pairKey);
    row.classList.toggle("current", current);
    if (current) row.setAttribute("aria-current", "true");
  });
  dom.cornerLookup.innerHTML = `${cornerPairHtml(tuple.W, tuple.N)}<em>→</em>${cornerPairHtml(mapped.l, mapped.v)}`;

  const proper = values.every((value) => value !== null) && new Set(values).size === 4;
  if (!proper) {
    dom.cornerStatus.textContent = "표에서 왼쪽·위 결과를 찾았습니다. 나머지 두 edge를 완성하세요.";
    dom.cornerFirstOutput.textContent = "—";
    dom.cornerShape.textContent = "오른쪽·아래 입력 대기";
    dom.cornerExplanation.textContent = "오른쪽·아래 숫자까지 서로 다르게 입력되면 첫 선 모양이 정해집니다.";
    return;
  }

  const first = { W: mapped.l, N: mapped.v, E: tuple.E, S: tuple.S };
  const type = strandType(first);
  dom.cornerStatus.textContent = "현재 입력의 맨 왼쪽 위 칸을 표에 넣은 결과입니다.";
  dom.cornerFirstOutput.innerHTML = cornerTupleHtml(first);
  dom.cornerShape.textContent = type === "turn" ? "꺾인 선 · ELBOW" : "곧은 선 · STRAIGHT";
  if (type === "turn") {
    dom.cornerExplanation.innerHTML = `새 왼쪽 <b>${mapped.l + 1}</b>은 아래 <b>${tuple.S + 1}</b>와 같고, 새 위 <b>${mapped.v + 1}</b>은 오른쪽 <b>${tuple.E + 1}</b>과 같습니다. 그래서 두 선이 꺾입니다.`;
  } else {
    dom.cornerExplanation.innerHTML = `새 왼쪽 <b>${mapped.l + 1}</b>은 오른쪽 <b>${tuple.E + 1}</b>과 같고, 새 위 <b>${mapped.v + 1}</b>은 아래 <b>${tuple.S + 1}</b>와 같습니다. 그래서 두 선이 곧게 이어집니다.`;
  }
}

function cornerTupleHtml({ W, N, E, S }) {
  return [
    ["왼쪽", W], ["위", N], ["오른쪽", E], ["아래", S],
  ].map(([label, value]) => `<span><b>${label}</b>${cornerColorHtml(value)}</span>`).join("");
}

function cornerPairHtml(left, top) {
  return `<span>${cornerColorHtml(left)}${cornerColorHtml(top)}</span>`;
}

function cornerColorHtml(value) {
  return value === null
    ? `<i class="digit missing">·</i>`
    : `<i class="digit v${value}">${value + 1}</i>`;
}

function inputFaceClass(x, y) {
  if (!state.inputValidation || state.inputValidation.ok) return "";
  if (state.inputValidation.invalidFaces.some((face) => face.x === x && face.y === y)) return "input-invalid";
  if (state.inputValidation.incompleteFaces.some((face) => face.x === x && face.y === y)) return "input-incomplete";
  return "";
}

function edgeDisplayName(key) {
  const [kind, y, x] = key.split(":");
  return `${kind === "h" ? "가로" : "세로"} edge ${kind}[${y}][${x}]`;
}

function gridEdgeValue(grid, key) {
  const [kind, yText, xText] = key.split(":");
  return grid[kind][Number(yText)][Number(xText)];
}

function selectExplainedEdge(key) {
  const frame = state.frames[state.frameIndex];
  if (!frame.activeEdges.has(key)) return;
  state.explainedEdge = key;
  dom.operationDetails.open = true;
  renderOperationDetails(frame);
}

function renderOperationDetails(frame) {
  const show = Boolean(frame.primitives?.length);
  dom.operationDetails.hidden = !show;
  if (!show) {
    dom.operationDetails.open = false;
    state.explainedEdge = null;
    return;
  }
  const bases = frame.primitives.filter(({ event }) => event.type === "alpha-base").length;
  const diamonds = frame.primitives.filter(({ event }) => event.type === "diamond").length;
  dom.operationSummary.textContent = `이번 단계 자세히 · 한 칸 표 ${bases}번 · 이웃과 맞추기 ${diamonds}번`;
  const chips = frame.primitives.map(({ event }, index) => {
    const label = event.type === "alpha-base"
      ? `한 칸 표 적용 · ${event.rowOffset + 1}번째 줄`
      : `이웃 칸과 공유 edge 맞추기 · ${event.rowOffset + 1}/${event.rowOffset + 2}번째 줄`;
    return `<span class="trace-chip">${index + 1}. ${label}</span>`;
  }).join("");

  let selectedHtml = `<p class="edge-reason">오른쪽의 <b>이전값→새값</b> edge를 누르면 왜 다시 바뀌었는지 표시합니다.</p>`;
  if (state.explainedEdge && frame.activeEdges.has(state.explainedEdge)) {
    const reasons = frame.edgeReasons.get(state.explainedEdge) ?? [];
    const oldValue = gridEdgeValue(frame.previousGrid, state.explainedEdge);
    const newValue = gridEdgeValue(frame.grid, state.explainedEdge);
    const last = reasons.at(-1);
    const cause = last
      ? last.event.type === "alpha-base"
        ? `마지막으로 한 칸 고정표를 적용했습니다.`
        : `마지막으로 새 이웃과 공유 edge를 맞췄습니다.`
      : "이번 묶음의 칸들을 함께 맞추면서 갱신했습니다.";
    selectedHtml = `<p class="edge-reason"><b>${edgeDisplayName(state.explainedEdge)}</b> · ${oldValue + 1}→${newValue + 1}<br>${reasons.length}번 바뀌었고, ${cause}</p>`;
  }

  dom.operationDetail.innerHTML = `
    <p>먼저 바깥 모서리 한 칸을 고정표로 만듭니다. 다음 칸을 붙일 때 공유 edge가 달라지면 먼저 만든 칸도 함께 다시 맞춥니다. 금색은 새로 보인 edge, 보라색은 다시 맞춘 edge입니다.</p>
    <div class="trace-sequence">${chips}</div>
    ${selectedHtml}`;
}

function renderUnavailableDetails() {
  const message = `<div class="empty-detail">유효한 Eₙ 입력이 완성되면 재귀 계산과 검증이 표시됩니다.</div>`;
  dom.interfaceTuples.innerHTML = message;
  dom.etaPlus.innerHTML = "";
  dom.etaMinus.innerHTML = "";
  dom.plusTraceCount.textContent = "입력 대기";
  dom.minusTraceCount.textContent = "입력 대기";
  dom.plusRows.innerHTML = message;
  dom.minusRows.innerHTML = message;
  dom.diamondCounter.textContent = "0 / 0";
  dom.previousDiamond.disabled = true;
  dom.nextDiamond.disabled = true;
  dom.diamondDetail.innerHTML = message;
  dom.checkGrid.innerHTML = message;
  dom.resultBadge.textContent = "입력 대기";
  dom.resultBadge.classList.remove("complete");
}

function renderTargetHeader(frame, n) {
  if (!state.result) {
    dom.targetEyebrow.textContent = "결과";
    dom.targetTitle.textContent = "입력이 완성되기를 기다리는 중";
    dom.targetCheck.textContent = "기다리는 중";
    dom.targetCheck.classList.add("pending");
    return;
  }
  const copy = {
    input: ["결과", "오른쪽 결과 — 아직 비어 있음", "기다리는 중"],
    interface: ["대각선 칸", "대각선 칸 — 그대로 복사 완료", `${4 * n}개 edge 유지`],
    plus: ["왼쪽 위 만드는 중", "왼쪽 위 영역 작업 상태", frame.operation],
    minus: ["오른쪽 아래 만드는 중", "오른쪽 아래 영역 작업 상태", frame.operation],
    complete: ["완성된 결과", `D<sub>${n}</sub> — 모든 칸 완성`, `${n * n}칸 완성`],
  }[frame.phase];
  dom.targetEyebrow.textContent = copy[0];
  dom.targetTitle.innerHTML = copy[1];
  dom.targetCheck.textContent = copy[2];
  dom.targetCheck.classList.toggle("pending", frame.phase !== "complete");
}

function renderGrid(svg, grid, { target, frame, phaseIndex }) {
  const size = 620;
  const margin = 58;
  const inner = size - 2 * margin;
  const cell = inner / grid.n;
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.replaceChildren();

  for (let y = 0; y < grid.n; y += 1) {
    for (let x = 0; x < grid.n; x += 1) {
      const region = x === y ? "diagonal" : y > x ? "plus" : "minus";
      const faceKeys = gridFaceEdgeKeys(x, y);
      const visible = !target || faceKeys.every((key) => frame.visibleEdges.has(key));
      const rowOffset = x === y ? -1 : Math.abs(y - x) - 1;
      const sign = region === "plus" ? "+" : region === "minus" ? "-" : null;
      const activeFace = frame.activeSide === sign && frame.activeRows.includes(rowOffset);
      const inputClass = target ? "" : inputFaceClass(x, y);
      const firstCorner = !target && grid.n > 1 && x === 0 && y === grid.n - 1;
      const sx = margin + x * cell;
      const sy = margin + (grid.n - 1 - y) * cell;
      svg.append(svgEl("rect", {
        class: `face-region ${region} ${visible ? "" : "hidden"} ${activeFace ? "process-active" : ""} ${inputClass} ${firstCorner ? "first-corner" : ""}`,
        x: sx + 1, y: sy + 1, width: cell - 2, height: cell - 2, rx: Math.min(12, cell * .08),
      }));

      if (target && visible && x !== y) {
        const tuple = faceTuple(grid, x, y);
        if (strandType(tuple)) drawStrands(svg, tuple, sx, sy, cell);
      }

      const cx = sx + cell / 2;
      const cy = sy + cell / 2;
      if (x === y && (!target || visible) && phaseIndex >= 1 && cell > 130) {
        addText(svg, cx, cy + 3, "🔒", "lock-text");
      }
      if (firstCorner && cell > 90) addText(svg, cx, cy + 3, "첫 칸", "first-corner-label");
    }
  }

  // Every physical edge is rendered exactly once.
  for (let y = 0; y <= grid.n; y += 1) {
    for (let x = 0; x < grid.n; x += 1) {
      const x1 = margin + x * cell;
      const x2 = x1 + cell;
      const sy = margin + (grid.n - y) * cell;
      const region = horizontalRegion(grid.n, x, y);
      const key = edgeKey("h", y, x);
      drawEdge(svg, x1, sy, x2, sy, grid.h[y][x], {
        key,
        visible: !target || frame.visibleEdges.has(key),
        locked: region === "diagonal" && phaseIndex >= 1,
        active: target ? frame.activeEdges.has(key) : frame.activeBlockEdges.has(key),
        tone: frame.activeSide === "+" ? "plus" : frame.activeSide === "-" ? "minus" : "",
        editable: !target && state.editing,
        selected: !target && state.selectedEdge === key,
        previousValue: target && frame.previousGrid ? gridEdgeValue(frame.previousGrid, key) : undefined,
        changeKind: frame.newBandEdges.has(key) ? "change-new" : frame.readjustedEdges.has(key) ? "change-readjusted" : "",
        explainable: target && frame.activeEdges.has(key),
      });
    }
  }
  for (let y = 0; y < grid.n; y += 1) {
    for (let x = 0; x <= grid.n; x += 1) {
      const sx = margin + x * cell;
      const y1 = margin + (grid.n - y) * cell;
      const y2 = y1 - cell;
      const region = verticalRegion(grid.n, x, y);
      const key = edgeKey("v", y, x);
      drawEdge(svg, sx, y1, sx, y2, grid.v[y][x], {
        key,
        visible: !target || frame.visibleEdges.has(key),
        locked: region === "diagonal" && phaseIndex >= 1,
        active: target ? frame.activeEdges.has(key) : frame.activeBlockEdges.has(key),
        tone: frame.activeSide === "+" ? "plus" : frame.activeSide === "-" ? "minus" : "",
        editable: !target && state.editing,
        selected: !target && state.selectedEdge === key,
        previousValue: target && frame.previousGrid ? gridEdgeValue(frame.previousGrid, key) : undefined,
        changeKind: frame.newBandEdges.has(key) ? "change-new" : frame.readjustedEdges.has(key) ? "change-readjusted" : "",
        explainable: target && frame.activeEdges.has(key),
      });
    }
  }

}

function drawEdge(svg, x1, y1, x2, y2, value, {
  key, visible, locked, active, tone, editable, selected, previousValue, changeKind, explainable,
}) {
  const assigned = value !== null;
  const changed = active && previousValue !== undefined && previousValue !== value;
  svg.append(svgEl("line", { class: "edge-underlay", x1, y1, x2, y2 }));
  if (locked) svg.append(svgEl("line", { class: "edge-lock", x1, y1, x2, y2 }));
  svg.append(svgEl("line", { class: `grid-edge value-${value} ${assigned ? "" : "unassigned"} ${visible ? "" : "hidden"} ${active ? `active ${tone}` : ""}`, x1, y1, x2, y2 }));
  if (!visible) return;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const group = svgEl("g", {
    class: `edge-label value-${value} ${assigned ? "" : "unassigned"} ${active ? `active ${tone}` : ""} ${changed ? `changed ${changeKind}` : ""} ${editable ? "editable" : ""} ${selected ? "selected" : ""} ${explainable ? "explainable" : ""}`,
    transform: `translate(${mx} ${my})`,
    role: editable || explainable ? "button" : "img",
    tabindex: editable || explainable ? "0" : "-1",
    "aria-label": changed
      ? `${edgeDisplayName(key)}: ${previousValue + 1}에서 ${value + 1}로 변경`
      : `${edgeDisplayName(key)}: ${assigned ? value + 1 : "미입력"}`,
  });
  const labelWidth = changed ? 42 : 22;
  group.append(svgEl("rect", { x: -labelWidth / 2, y: -10, width: labelWidth, height: 20, rx: 6 }));
  const text = svgEl("text", { x: 0, y: .5 });
  text.textContent = changed ? `${previousValue + 1}→${value + 1}` : assigned ? String(value + 1) : "·";
  group.append(text);
  svg.append(group);

  if (editable || explainable) {
    const activate = () => editable ? selectEdge(key) : selectExplainedEdge(key);
    const hit = svgEl("line", { class: "edge-hit", x1, y1, x2, y2, tabindex: "-1" });
    hit.addEventListener("click", activate);
    group.addEventListener("click", activate);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    svg.append(hit);
  }
}

function drawStrands(svg, tuple, sx, sy, cell) {
  const cx = sx + cell / 2;
  const cy = sy + cell / 2;
  const pad = Math.min(18, cell * .13);
  const W = [sx + pad, cy], N = [cx, sy + pad], E = [sx + cell - pad, cy], S = [cx, sy + cell - pad];
  const type = strandType(tuple);
  if (type === "straight") {
    svg.append(svgEl("path", { class: `strand value-${tuple.W}`, d: `M ${W[0]} ${W[1]} L ${E[0]} ${E[1]}` }));
    svg.append(svgEl("path", { class: `strand value-${tuple.N}`, d: `M ${N[0]} ${N[1]} L ${S[0]} ${S[1]}` }));
  } else {
    const bend = cell * .17;
    svg.append(svgEl("path", {
      class: `strand value-${tuple.W}`,
      d: `M ${W[0]} ${W[1]} C ${cx - bend} ${cy} ${cx} ${cy + bend} ${S[0]} ${S[1]}`,
    }));
    svg.append(svgEl("path", {
      class: `strand value-${tuple.N}`,
      d: `M ${N[0]} ${N[1]} C ${cx} ${cy - bend} ${cx + bend} ${cy} ${E[0]} ${E[1]}`,
    }));
  }
}

function horizontalRegion(n, x, y) {
  const adjacent = [];
  if (y > 0) adjacent.push([x, y - 1]);
  if (y < n) adjacent.push([x, y]);
  return classifyAdjacent(adjacent);
}

function verticalRegion(n, x, y) {
  const adjacent = [];
  if (x > 0) adjacent.push([x - 1, y]);
  if (x < n) adjacent.push([x, y]);
  return classifyAdjacent(adjacent);
}

function classifyAdjacent(faces) {
  if (faces.some(([x, y]) => x === y)) return "diagonal";
  if (faces.some(([x, y]) => y > x)) return "plus";
  return "minus";
}

function renderInterface() {
  dom.interfaceTuples.innerHTML = state.result.interface.map((tuple) =>
    `<span class="tuple-chip locked">I<sub>${tuple.index}</sub>=(${digits([tuple.W,tuple.N,tuple.E,tuple.S])})</span>`,
  ).join("");
  dom.etaPlus.innerHTML = pairChips(state.result.plus.eta, "η⁺");
  dom.etaMinus.innerHTML = pairChips(state.result.minus.eta, "η⁻");
}

function pairChips(pairs, name) {
  if (!pairs.length) return `<span class="tuple-chip">∅ (n=1)</span>`;
  return pairs.map((pair,index) => `<span class="tuple-chip">${name}<sub>${index}</sub>=(${digits(pair)})</span>`).join("");
}

function digits(values) {
  return values.map((value) => `<i class="digit v${value}">${value + 1}</i>`).join("");
}

function renderHalves(phaseIndex) {
  const plusDiamonds = state.result.plus.trace.filter(({ type }) => type === "diamond").length;
  const minusDiamonds = state.result.minus.trace.filter(({ type }) => type === "diamond").length;
  dom.plusTraceCount.textContent = `${state.result.plus.before.length} rows · ${plusDiamonds} diamond calls`;
  dom.minusTraceCount.textContent = `${state.result.minus.before.length} rows · ${minusDiamonds} diamond calls`;
  dom.plusRows.innerHTML = rowPreview(state.result.plus.before, state.result.plus.after, phaseIndex >= 2);
  dom.minusRows.innerHTML = rowPreview(state.result.minus.before, state.result.minus.after, phaseIndex >= 3);
}

function rowPreview(before, after, revealed) {
  if (!before.length) return `<div class="empty-detail">n=1에서는 strict half-region이 비어 있어 map은 identity입니다.</div>`;
  return before.map((row,index) => `
    <div class="abstract-row">
      <span>row ${index + 1}</span>
      <div class="orientation-list">
        ${row.map(orientationHtml).join("")}
        <i class="row-arrow">→</i>
        ${revealed ? after[index].map(orientationHtml).join("") : '<span class="orientation">변환 대기</span>'}
      </div>
    </div>`).join("");
}

function orientationHtml({ l, v }) {
  return `<span class="orientation">(${digits([l])}→${digits([v])})</span>`;
}

function allDiamondEvents() {
  return [...state.result.plus.trace, ...state.result.minus.trace].filter(({ type }) => type === "diamond");
}

function changeDiamond(delta) {
  const events = allDiamondEvents();
  if (!events.length) return;
  state.diamondIndex = (state.diamondIndex + delta + events.length) % events.length;
  renderDiamondDetail();
}

function renderDiamondDetail() {
  const events = allDiamondEvents();
  if (!events.length) {
    dom.diamondCounter.textContent = "0 / 0";
    dom.previousDiamond.disabled = true;
    dom.nextDiamond.disabled = true;
    dom.diamondDetail.innerHTML = `<div class="empty-detail">n=1에는 diamond call이 없습니다.</div>`;
    return;
  }
  state.diamondIndex = Math.min(state.diamondIndex, events.length - 1);
  const event = events[state.diamondIndex];
  dom.diamondCounter.textContent = `${state.diamondIndex + 1} / ${events.length}`;
  dom.previousDiamond.disabled = false;
  dom.nextDiamond.disabled = false;
  dom.diamondDetail.innerHTML = `
    <div class="diamond-side">
      <h3>${event.side === "+" ? "NW" : "SE"} · width ${event.width} · BEFORE</h3>
      <div class="diamond-row"><b>o₁</b>${event.sourceTop.map(orientationHtml).join("")}</div>
      <div class="diamond-row"><b>o₂</b>${event.sourceMiddle.map(orientationHtml).join("")}</div>
    </div>
    <div class="diamond-arrow">
      Φ<sub>k</sub> ⟶
      <span class="shift-word">s = (${event.shifts.map(formatLabel).join(", ")})</span>
    </div>
    <div class="diamond-side">
      <h3>AFTER · 같은 k</h3>
      <div class="diamond-row"><b>o′₁</b>${event.targetTop.map(orientationHtml).join("")}</div>
      <div class="diamond-row"><b>o′₂</b>${event.targetMiddle.map(orientationHtml).join("")}</div>
    </div>`;
}

function renderChecks(phaseIndex) {
  const actual = {
    source: validateE(state.source).ok,
    interface: state.result.interface.length === state.source.n,
    factor: true,
    plus: state.result.checks.plusBoundaryOrdered,
    minus: state.result.checks.minusBoundaryOrdered,
    target: validateD(state.result.target).ok,
    fixed: state.result.checks.interfaceFixed,
    inverse: state.roundTripOk,
  };
  dom.checkGrid.innerHTML = CHECKS.map(([key,label,threshold]) => {
    const shown = phaseIndex >= threshold;
    const pass = shown && actual[key];
    return `<div class="check-item ${pass ? "pass" : ""}"><b>${pass ? "✓" : "·"}</b><span>${label}</span></div>`;
  }).join("");
}

function svgEl(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key,value]) => element.setAttribute(key, value));
  return element;
}

function addText(svg, x, y, content, className) {
  const text = svgEl("text", { x, y, class: className });
  text.textContent = content;
  svg.append(text);
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.hash = `g=${encodeGrid(state.source)}&f=${state.frameIndex}&e=${state.editing ? 1 : 0}`;
  history.replaceState(null, "", url);
}

function loadFrameIndex() {
  const value = Number(new URLSearchParams(location.hash.slice(1)).get("f"));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function loadEditMode() {
  return new URLSearchParams(location.hash.slice(1)).get("e") === "1";
}

function loadGrid() {
  try {
    const encoded = new URLSearchParams(location.hash.slice(1)).get("g");
    return encoded ? decodeDraftGrid(encoded) : null;
  } catch (error) {
    console.warn("저장된 full-grid 구성을 읽지 못했습니다.", error);
    return null;
  }
}

async function copyLink() {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
  } catch {
    const input = document.createElement("textarea");
    input.value = location.href;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast("현재 전체 Eₙ↔Dₙ 예제를 포함한 링크를 복사했습니다.");
}

let toastTimer;
function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 2300);
}

function configurationId(grid) {
  const text = JSON.stringify(grid);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
