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
  secondCornerStep,
  secondSoutheastStep,
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
const SWAP_DETAIL = Object.freeze({
  1: "1↔2 · 3↔4",
  2: "1↔3 · 2↔4",
  3: "1↔4 · 2↔3",
});
const SWAP_PAIRS = Object.freeze({
  1: Object.freeze([[0, 1], [2, 3]]),
  2: Object.freeze([[0, 2], [1, 3]]),
  3: Object.freeze([[0, 3], [1, 2]]),
});

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
  bandSelection: null,
  bandMacro: { frameIndex: loadFrameIndex(), step: loadBandMacroStep() },
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
    "cornerExplanation", "cornerExplainer",
    "neighborLive", "neighborStatus", "neighborDownStep", "neighborRightStep", "neighborAStep",
    "neighborBeforeDiagram", "neighborAfterDiagram", "neighborExplanation", "neighborExplainer",
    "neighborEyebrow", "neighborExplainerTitle", "neighborIntro", "neighborScope", "neighborPositionKey",
    "neighborPositionDiagram", "neighborPositionText", "neighborRuleDescription", "neighborRuleAxis",
    "neighborFirstHeader", "neighborSecondHeader", "neighborAHeader", "neighborBeforeLabel", "neighborAfterLabel",
    "stageExplainer", "stageEyebrow", "stageExplainerTitle", "stageSummary", "stageBadge", "stageBody",
    "transformName", "transformNote", "interfaceTuples", "etaPlus", "etaMinus", "plusTraceCount",
    "minusTraceCount", "plusRows", "minusRows", "previousDiamond", "nextDiamond", "diamondCounter",
    "diamondDetail", "checkGrid", "resultBadge", "configurationId", "a11yStatus", "toast",
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
    state.bandMacro = { frameIndex: 0, step: 1 };
    state.bandSelection = null;
    render();
    announceCurrentState();
  });
  dom.previousButton.addEventListener("click", () => moveFrame(-1));
  dom.nextButton.addEventListener("click", () => moveFrame(1));
  dom.playButton.addEventListener("click", toggleAutoplay);
  dom.operationSummary.addEventListener("click", stopAutoplay);
  dom.previousDiamond.addEventListener("click", () => changeDiamond(-1));
  dom.nextDiamond.addEventListener("click", () => changeDiamond(1));
  dom.stageBody.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button, summary, a, input, select, textarea")) stopAutoplay();
    const stepButton = event.target.closest("[data-band-step]");
    if (stepButton instanceof HTMLButtonElement) {
      const frame = state.frames[state.frameIndex];
      if (!isBandFrame(frame)) return;
      const scrollPosition = { x: window.scrollX, y: window.scrollY };
      stopAutoplay();
      state.bandMacro = { frameIndex: state.frameIndex, step: Number(stepButton.dataset.bandStep) };
      state.bandSelection = null;
      render();
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      dom.stageBody.querySelector(`[data-band-step="${state.bandMacro.step}"]`)?.focus({ preventScroll: true });
      announceCurrentState();
      return;
    }
    const button = event.target.closest("[data-band-face]");
    if (!(button instanceof HTMLButtonElement)) return;
    const frame = state.frames[state.frameIndex];
    if (!isBandFrame(frame)) return;
    const scrollPosition = { x: window.scrollX, y: window.scrollY };
    stopAutoplay();
    state.bandSelection = {
      frameIndex: state.frameIndex,
      macroStep: currentBandStep(frame),
      faceKey: button.dataset.bandFace,
    };
    render();
    window.scrollTo(scrollPosition.x, scrollPosition.y);
    const selectedButton = dom.stageBody.querySelector(`[data-band-face="${button.dataset.bandFace}"]`);
    selectedButton?.focus({ preventScroll: true });
    const selectedLabel = selectedButton?.querySelector(":scope > span")?.textContent.trim() ?? "선택한 칸";
    announce(`${selectedLabel}. 이 시점의 실제 숫자와 바뀐 이유를 표시했습니다.`);
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const interactiveTarget = isInteractiveKeyTarget(event.target);
    const editableEdgeTarget = event.target instanceof Element
      && Boolean(event.target.closest("#sourceGrid .edge-label.editable"));
    if (state.editing && (!interactiveTarget || editableEdgeTarget)) {
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
    if (interactiveTarget) return;
    if (state.editing) return;
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
  state.selectedEdge = null;
  state.frameIndex = 0;
  state.diamondIndex = 0;
  state.explainedEdge = null;
  state.bandSelection = null;
  state.bandMacro = { frameIndex: 0, step: 1 };
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
  restoreSourceEdgeFocus(key);
}

function setSelectedEdgeValue(value) {
  if (!state.editing || !state.selectedEdge) return;
  const restoreFocus = document.activeElement?.closest?.("#sourceGrid .edge-label")?.dataset.edgeKey === state.selectedEdge;
  const selectedKey = state.selectedEdge;
  const [kind, yText, xText] = state.selectedEdge.split(":");
  const y = Number(yText);
  const x = Number(xText);
  state.source[kind][y][x] = value;
  state.frameIndex = 0;
  state.explainedEdge = null;
  state.bandSelection = null;
  state.bandMacro = { frameIndex: 0, step: 1 };
  recompute();
  if (restoreFocus) restoreSourceEdgeFocus(selectedKey);
}

function restoreSourceEdgeFocus(key) {
  dom.sourceGrid.querySelector(`.edge-label[data-edge-key="${key}"]`)?.focus({ preventScroll: true });
}

function isInteractiveKeyTarget(target) {
  return target instanceof Element && Boolean(target.closest(
    "button, input, select, textarea, summary, a, [role='button'], [contenteditable='true']",
  ));
}

function announce(message) {
  dom.a11yStatus.textContent = message;
}

function announceCurrentState() {
  const macro = dom.stageBody.querySelector(".band-order-card.current span")?.textContent.trim();
  const detail = macro ? `${macro}. ` : "";
  announce(`${dom.stepTitle.textContent.trim()}. ${detail}${dom.operationBadge.textContent.trim()}`);
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
  advanceProcess(delta);
}

function advanceProcess(delta) {
  const frame = state.frames[state.frameIndex];
  if (isBandFrame(frame)) {
    const step = currentBandStep(frame);
    if (delta > 0 && step < 3) {
      state.bandMacro = { frameIndex: state.frameIndex, step: step + 1 };
      state.bandSelection = null;
      state.explainedEdge = null;
      render();
      announceCurrentState();
      return;
    }
    if (delta < 0 && step > 1) {
      state.bandMacro = { frameIndex: state.frameIndex, step: step - 1 };
      state.bandSelection = null;
      state.explainedEdge = null;
      render();
      announceCurrentState();
      return;
    }
  }
  const target = Math.max(0, Math.min(state.frames.length - 1, state.frameIndex + delta));
  const targetFrame = state.frames[target];
  setFrame(target, { bandStep: delta < 0 && isBandFrame(targetFrame) ? 3 : 1 });
}

function setFrame(value, { bandStep = 1 } = {}) {
  if (value !== state.frameIndex) state.explainedEdge = null;
  state.frameIndex = Math.max(0, Math.min(state.frames.length - 1, value));
  state.bandMacro = { frameIndex: state.frameIndex, step: isBandFrame(state.frames[state.frameIndex]) ? bandStep : 1 };
  state.bandSelection = null;
  render();
  announceCurrentState();
}

function toggleAutoplay() {
  if (state.timer) {
    stopAutoplay();
    return;
  }
  if (state.frameIndex === state.frames.length - 1) {
    state.frameIndex = 0;
    state.bandMacro = { frameIndex: 0, step: 1 };
  }
  dom.playButton.textContent = "일시 정지";
  render();
  state.timer = window.setInterval(() => {
    if (state.frameIndex === state.frames.length - 1) {
      stopAutoplay();
      return;
    }
    advanceProcess(1);
  }, autoplayDelay(state.source.n));
}

function stopAutoplay() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  dom.playButton.textContent = "자동 재생";
}

function autoplayDelay(n) {
  return n >= 5 ? 3400 : 3000;
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
        updates: replayFrame.updates,
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
    checkpoint: null,
    side: null,
    width: 0,
    segmentIndex: null,
    totalSegments: null,
    newVisibleEdges: new Set(),
    newBandEdges: new Set(),
    readjustedEdges: new Set(),
    previousGrid: null,
    primitives: [],
    primitiveSteps: [],
    edgeReasons: new Map(),
    ...frame,
    grid: cloneGrid(frame.grid),
    visibleEdges: new Set(frame.visibleEdges),
  };
}

function isBandFrame(frame) {
  return Boolean(frame?.checkpoint && frame.width >= 3);
}

function currentBandStep(frame) {
  if (!isBandFrame(frame) || state.bandMacro?.frameIndex !== state.frameIndex) return 1;
  return Math.max(1, Math.min(3, Number(state.bandMacro.step) || 1));
}

function bandMainIndex(frame) {
  return frame.primitiveSteps.findIndex(({ event }) => event.type === "diamond"
    && event.width === frame.width
    && event.rowOffset === frame.checkpoint.rowOffset);
}

function presentationFrame(frame) {
  if (!isBandFrame(frame)) return frame;
  if (state.bandMacro?.frameIndex !== state.frameIndex) {
    state.bandMacro = { frameIndex: state.frameIndex, step: 1 };
  }
  const step = currentBandStep(frame);
  const mainIndex = bandMainIndex(frame);
  if (mainIndex < 0) throw new Error(`${frame.width}칸을 붙이는 중심 계산을 찾지 못했습니다.`);
  const mainStep = frame.primitiveSteps[mainIndex];
  const snapshots = {
    1: {
      start: frame.previousGrid,
      end: mainStep.beforeGrid,
      primitiveSteps: frame.primitiveSteps.slice(0, mainIndex),
      primitives: frame.primitives.slice(0, mainIndex),
      label: "① 안쪽 칸 먼저 바꾸기",
      note: "새 줄을 붙이기 전에 안쪽 칸을 먼저 바꿈",
    },
    2: {
      start: mainStep.beforeGrid,
      end: mainStep.afterGrid,
      primitiveSteps: [mainStep],
      primitives: [frame.primitives[mainIndex]],
      label: `② 새 ${frame.width}칸 붙이고 함께 맞추기`,
      note: "새 줄과 맞닿은 칸을 한꺼번에 바꿈",
    },
    3: {
      start: mainStep.afterGrid,
      end: frame.grid,
      primitiveSteps: frame.primitiveSteps.slice(mainIndex + 1),
      primitives: frame.primitives.slice(mainIndex + 1),
      label: "③ 남은 안쪽 칸 끝내기",
      note: "남은 안쪽 칸을 바꿔 이번 묶음을 끝냄",
    },
  };
  const snapshot = snapshots[step];
  const previousVisible = new Set([...frame.visibleEdges].filter((key) => !frame.newVisibleEdges.has(key)));
  const visibleEdges = step === 1 ? previousVisible : new Set(frame.visibleEdges);
  const activeEdges = diffGridEdges(snapshot.start, snapshot.end);
  const activeBlockEdges = new Set(snapshot.primitiveSteps.flatMap(({ mutations }) => mutations.map(({ key }) => key)));
  const activeRows = [...new Set(snapshot.primitiveSteps.flatMap(({ updates }) => updates.map(({ rowOffset }) => rowOffset)))];
  const newVisibleEdges = step === 2 ? new Set(frame.newVisibleEdges) : new Set();
  const newBandEdges = new Set([...activeEdges].filter((key) => step === 2 && !previousVisible.has(key)));
  const readjustedEdges = new Set([...activeEdges].filter((key) => !newBandEdges.has(key)));
  const touchedFaceKeys = new Set(snapshot.primitiveSteps.flatMap(({ touchedFaces }) => touchedFaces.map(({ key }) => key)));
  const bandActionRoles = new Map();
  for (let layer = 0; layer < frame.width; layer += 1) {
    const rowOffset = frame.checkpoint.rowOffset + layer;
    for (let index = 0; index < frame.width - layer; index += 1) {
      const { x, y } = halfEntryFaceCoordinates(frame.side, rowOffset, index);
      const key = faceKey(x, y);
      const role = layer === 0 ? "new" : "old";
      const action = step === 1 && role === "new"
        ? "waiting"
        : step === 2 && role === "new"
          ? "joining"
          : step === 3 && role === "new"
            ? "joined"
            : touchedFaceKeys.has(key)
              ? "affected"
              : "quiet";
      bandActionRoles.set(key, action);
    }
  }
  const edgeReasons = new Map();
  snapshot.primitiveSteps.forEach((primitive) => {
    primitive.mutations.forEach((mutation) => {
      if (!activeEdges.has(mutation.key)) return;
      if (!edgeReasons.has(mutation.key)) edgeReasons.set(mutation.key, []);
      edgeReasons.get(mutation.key).push({ ...mutation, event: primitive.event, primitiveIndex: primitive.primitiveIndex });
    });
  });
  const sideName = frame.side === "+" ? "왼쪽 위" : "오른쪽 아래";
  const descriptions = {
    1: `먼저 이미 있는 안쪽 칸을 바꿉니다. 새 ${frame.width}칸은 아직 붙이지 않습니다.`,
    2: `다음으로 새 ${frame.width}칸을 붙이고, 바로 맞닿은 안쪽 칸도 한꺼번에 바꿉니다.`,
    3: "마지막으로 남은 안쪽 칸을 바꾸면 이번 묶음이 끝납니다.",
  };
  return {
    ...frame,
    baseFrame: frame,
    bandMacroStep: step,
    mainIndex,
    grid: cloneGrid(snapshot.end),
    previousGrid: cloneGrid(snapshot.start),
    visibleEdges,
    activeEdges,
    activeBlockEdges,
    activeRows,
    newVisibleEdges,
    newBandEdges,
    readjustedEdges,
    bandActionRoles,
    edgeReasons,
    primitives: snapshot.primitives,
    primitiveSteps: snapshot.primitiveSteps,
    title: `${sideName} · ${snapshot.label}`,
    description: descriptions[step],
    operation: `${frame.segmentIndex + 1}/${frame.totalSegments}번째 묶음 · ${snapshot.label}`,
    change: `${activeEdges.size}개 edge 변화`,
    mapLabel: snapshot.label,
    mapNote: snapshot.note,
  };
}

function makeEmptyHalfFrame(sign, grid, visibleEdges) {
  const northwest = sign === "+";
  return makeFrame({
    phase: northwest ? "plus" : "minus",
    side: sign,
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
  const primitiveSteps = replayPrimitiveSteps(previous, primitives, sign);
  const replayedGrid = primitiveSteps.at(-1)?.afterGrid ?? previous;
  if (!gridsEqual(replayedGrid, grid)) {
    throw new Error(`${sideName} ${event.width}칸 묶음의 실제 계산 재생 결과가 checkpoint와 맞지 않습니다.`);
  }
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
    checkpoint: event,
    side: sign,
    width: event.width,
    segmentIndex: index,
    totalSegments: total,
    activeRows: [event.rowOffset],
    activeEdges: changedEdges,
    activeBlockEdges,
    newVisibleEdges,
    newBandEdges,
    readjustedEdges,
    previousGrid: previous,
    primitives,
    primitiveSteps,
    edgeReasons,
    title: `${sideName} 영역 만들기`,
    description,
    operation: `${sideName} · ${index + 1}/${total}번째 묶음`,
    change: `새로 보인 칸 ${event.width}개 · 새 edge ${newVisibleEdges.size}개 · 기존 edge ${readjustedEdges.size}개 다시 맞춤`,
    mapLabel: "한 칸씩",
    mapNote: "모서리부터 대각선으로",
  });
}

function replayPrimitiveSteps(previousGrid, primitives, sign) {
  const work = cloneGrid(previousGrid);
  return primitives.map((primitive, primitiveIndex) => {
    const beforeGrid = cloneGrid(work);
    primitive.mutations.forEach(({ key, oldValue, newValue }) => {
      const current = gridEdgeValue(work, key);
      if (current !== oldValue) {
        throw new Error(`계산 ${primitiveIndex + 1}의 ${key} 이전값이 실제 격자와 맞지 않습니다.`);
      }
      setGridEdgeValue(work, key, newValue);
    });
    const afterGrid = cloneGrid(work);
    const directFaces = primitiveDirectFaces(primitive, sign, work.n);
    const touchedFaceKeys = new Set();
    primitive.mutations.forEach(({ key }) => {
      adjacentHalfFaces(key, work.n, sign).forEach(({ x, y }) => touchedFaceKeys.add(faceKey(x, y)));
    });
    const touchedFaces = [...touchedFaceKeys]
      .map((key) => {
        const { x, y } = parseFaceKey(key);
        const before = faceTuple(beforeGrid, x, y);
        const after = faceTuple(afterGrid, x, y);
        return {
          key,
          x,
          y,
          before,
          after,
          changedSides: faceChangedSides(before, after),
          direct: directFaces.has(key),
        };
      })
      .sort((left, right) => left.y - right.y || left.x - right.x);
    return {
      ...primitive,
      primitiveIndex,
      beforeGrid,
      afterGrid,
      directFaces,
      touchedFaces,
    };
  });
}

function primitiveDirectFaces(primitive, sign, n) {
  const keys = new Set();
  primitive.updates.forEach(({ rowOffset, source }) => {
    source.forEach((_, index) => {
      const { x, y } = halfEntryFaceCoordinates(sign, rowOffset, index);
      if (x >= 0 && x < n && y >= 0 && y < n) keys.add(faceKey(x, y));
    });
  });
  return keys;
}

function halfEntryFaceCoordinates(sign, rowOffset, index) {
  const distance = rowOffset + 1;
  return sign === "+"
    ? { x: index, y: index + distance }
    : { x: index + distance, y: index };
}

function adjacentHalfFaces(key, n, sign) {
  const [kind, firstText, secondText] = key.split(":");
  const first = Number(firstText);
  const second = Number(secondText);
  const faces = kind === "h"
    ? [
        { x: second, y: first },
        { x: second, y: first - 1 },
      ]
    : [
        { x: second, y: first },
        { x: second - 1, y: first },
      ];
  return faces.filter(({ x, y }) => x >= 0 && x < n && y >= 0 && y < n
    && (sign === "+" ? y > x : x > y));
}

function faceKey(x, y) {
  return `${x}:${y}`;
}

function parseFaceKey(key) {
  const [x, y] = key.split(":").map(Number);
  return { x, y };
}

function faceChangedSides(before, after) {
  return ["W", "N", "E", "S"].filter((side) => before[side] !== after[side]);
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
  const n = state.source.n;
  const baseFrame = state.frames[state.frameIndex];
  const frame = presentationFrame(baseFrame);
  syncUrl();
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
    if (index === phaseIndex) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.disabled = index > 0 && (!state.result || state.editing);
  });

  dom.transformName.textContent = frame.mapLabel;
  dom.transformNote.textContent = frame.mapNote;

  renderGrid(dom.sourceGrid, state.source, { target: false, frame, phaseIndex });
  renderGrid(dom.targetGrid, frame.grid, { target: true, frame, phaseIndex });
  renderCornerExplanation();
  renderNeighborExplanation(frame);
  renderStageExplanation(frame);
  renderOperationDetails(frame);
  if (state.result) {
    renderInterface();
    renderHalves(phaseIndex);
    renderDiamondDetail();
    renderChecks(phaseIndex);
  } else {
    renderUnavailableDetails();
  }

  dom.previousButton.disabled = state.editing || (state.frameIndex === 0 && !isBandFrame(baseFrame));
  dom.nextButton.disabled = state.editing || !state.result || complete;
  dom.playButton.disabled = state.editing || !state.result;
  dom.resultBadge.textContent = state.result
    ? complete ? "현재 예제 왕복 확인 완료" : "진행 중"
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

function renderNeighborExplanation(frame) {
  resetNeighborRuleHighlights();
  const southeast = stageKind(frame) === "minus-second";
  configureNeighborExplainer(southeast);

  if (state.source.n < 3) {
    setNeighborUnavailable(southeast ? "n=3부터 A의 왼쪽 L과 위 U가 생깁니다." : "n=3부터 A의 아래 D와 오른쪽 R이 생깁니다.", "n을 3 이상으로 바꾸면 두 번째 계산을 보여줍니다.");
    return;
  }
  if (!state.result) {
    setNeighborUnavailable(southeast ? "A·L·U 세 칸의 입력을 완성하면 계산합니다." : "A·D·R 세 칸의 입력을 완성하면 계산합니다.", "현재 입력 전체가 올바르게 완성되기를 기다리고 있습니다.");
    return;
  }

  const step = southeast
    ? secondSoutheastStep(state.source, state.result)
    : secondCornerStep(state.source, state.result);
  const firstRole = southeast ? "L" : "D";
  const secondRole = southeast ? "U" : "R";
  const firstPart = southeast ? step.left : step.down;
  const secondPart = southeast ? step.up : step.right;
  const activeSides = southeast ? ["S", "E"] : ["W", "N"];
  dom.neighborLive.classList.remove("unavailable");
  dom.neighborStatus.textContent = "";
  dom.neighborDownStep.innerHTML = neighborResultStepHtml(firstRole, step.referencePair, firstPart, activeSides);
  dom.neighborRightStep.innerHTML = neighborResultStepHtml(secondRole, step.referencePair, secondPart, activeSides);
  dom.neighborAStep.innerHTML = southeast ? neighborSoutheastAHtml(step) : neighborSimpleAHtml(step);
  dom.neighborBeforeDiagram.classList.toggle("southeast", southeast);
  dom.neighborAfterDiagram.classList.toggle("southeast", southeast);
  dom.neighborBeforeDiagram.innerHTML = southeast ? southeastStateDiagramHtml(step, "before") : stateDiagramHtml(step, "before");
  dom.neighborAfterDiagram.innerHTML = southeast ? southeastStateDiagramHtml(step, "after") : stateDiagramHtml(step, "after");

  dom.neighborExplanation.hidden = state.source.n === 3;
  dom.neighborExplanation.textContent = state.source.n === 3
    ? ""
    : "지금 보이는 값은 두 번째 묶음 직후입니다. 더 큰 묶음을 붙일 때 공유 변이 다시 조정될 수 있습니다.";

  highlightNeighborRule(firstPart.kind, step.referenceKind, firstRole);
  highlightNeighborRule(secondPart.kind, step.referenceKind, secondRole);
}

function configureNeighborExplainer(southeast) {
  dom.neighborExplainer.dataset.side = southeast ? "minus" : "plus";
  dom.neighborEyebrow.textContent = southeast ? "오른쪽 아래 · 두 번째 묶음" : "왼쪽 위 · 두 번째 묶음";
  dom.neighborExplainerTitle.textContent = southeast ? "A 준비 → L·U 동시 연결 → A 마무리" : "D·R을 함께 정하고 A를 마무리";
  dom.neighborIntro.innerHTML = southeast
    ? "<b>L과 U를 차례로 따로 계산하는 것이 아닙니다.</b> A를 준비한 뒤, L·U와 A를 한 가운데 계산에서 함께 바꾸고, 마지막으로 A를 마무리합니다."
    : "<b>원래 입력 A·D·R을 다시 읽습니다.</b> D와 R은 같은 가운데 계산에서 동시에 정해지고, 그 결과를 공유하도록 A를 마무리합니다.";
  dom.neighborScope.textContent = "n≥3 · 두 번째 묶음";
  dom.neighborPositionKey.setAttribute("aria-label", southeast ? "A L U 위치" : "A D R 위치");
  dom.neighborPositionDiagram.classList.toggle("southeast", southeast);
  dom.neighborPositionDiagram.innerHTML = southeast ? "<b>U</b><b>L</b><b>A</b>" : "<b>A</b><b>R</b><b>D</b>";
  dom.neighborPositionText.textContent = southeast ? "A 바깥 모서리 · L 왼쪽 · U 위" : "A 첫 칸 · D 아래 · R 오른쪽";
  dom.neighborRuleDescription.innerHTML = southeast
    ? "<b>A의 왼쪽·아래 두 숫자로 열</b>을 고르고, <b>L/U의 아래·오른쪽 두 숫자로 행</b>을 고릅니다. 만나는 칸의 두 교환을 ②에서 동시에 씁니다."
    : "<b>A의 왼쪽·아래 두 숫자로 열</b>을 고르고, <b>D/R의 왼쪽·위 두 숫자로 행</b>을 고릅니다. 만나는 칸이 바로 적용할 바꾸기입니다.";
  dom.neighborRuleAxis.textContent = southeast ? "L/U 행 ↓" : "D/R 행 ↓";
  dom.neighborRuleAxis.closest("table")?.setAttribute("aria-label", southeast ? "L과 U의 숫자 바꾸기 선택 근거표" : "D와 R의 숫자 바꾸기 선택 근거표");
  dom.neighborFirstHeader.innerHTML = southeast
    ? "<b>L</b><div><h3>L쪽 계산</h3><span>U와 같은 시점에 계산</span></div>"
    : "<b>D</b><div><h3>D쪽 계산</h3><span>R과 같은 시점에 계산</span></div>";
  dom.neighborSecondHeader.innerHTML = southeast
    ? "<b>U</b><div><h3>U쪽 계산</h3><span>L과 같은 시점에 계산</span></div>"
    : "<b>R</b><div><h3>R쪽 계산</h3><span>D와 같은 시점에 계산</span></div>";
  dom.neighborAHeader.innerHTML = southeast
    ? "<b>A</b><div><h3>A에서 실제 3단계 보기</h3><span>① 준비 → ② L·U와 동시 연결 → ③ 마무리</span></div>"
    : "<b>A</b><div><h3>공유 변을 반영해 A 마무리</h3><span>D는 A의 왼쪽, R은 A의 위쪽에만 반영</span></div>";
  dom.neighborBeforeLabel.textContent = "A 한 칸만 완성";
  dom.neighborAfterLabel.textContent = southeast ? "A·L·U 두 번째 묶음 결과" : "A·D·R 두 번째 묶음 결과";
}

function neighborResultStepHtml(role, referencePair, part, activeSides = ["W", "N"]) {
  const tone = role.toLowerCase();
  return `
    <div class="neighbor-read-row">
      <span>선택표에 넣는 두 칸</span>
      <div class="neighbor-face-pair">
        ${miniFaceFigureHtml("원래 A", "A", { W: referencePair[0], S: referencePair[1] }, { visible: ["W", "S"], active: ["W", "S"], tone: "a" })}
        <b class="neighbor-plus">+</b>
        ${miniFaceFigureHtml(`원래 ${role}`, role, part.before, { visible: activeSides, active: activeSides, tone })}
      </div>
    </div>
    <div class="neighbor-chosen-change">
      <span>선택된 숫자 바꾸기</span>
      <strong>${swapDirectionsHtml(part.shift)}</strong>
    </div>
    <div class="neighbor-result-row">
      <span>${role}에 적용한 결과</span>
      <div class="neighbor-face-change">
        ${miniFaceFigureHtml("바꾸기 전", role, part.before, { active: activeSides, tone })}
        <b class="neighbor-face-arrow">→</b>
        ${miniFaceFigureHtml("바꾼 뒤", role, part.after, { active: activeSides, changed: activeSides, tone })}
      </div>
    </div>`;
}

function miniFaceFigureHtml(caption, role, tuple, options = {}) {
  return `<figure class="neighbor-mini-figure">${miniFaceHtml(role, tuple, options)}<figcaption>${caption}</figcaption></figure>`;
}

function miniFaceHtml(role, tuple, {
  visible = ["W", "N", "E", "S"],
  active = visible,
  changed = [],
  badges = {},
  tone = role.toLowerCase(),
} = {}) {
  const sideNames = { W: "왼쪽", N: "위", E: "오른쪽", S: "아래" };
  const visibleSides = new Set(visible);
  const activeSides = new Set(active);
  const changedSides = new Set(changed);
  const edgeHtml = ["N", "W", "E", "S"].map((side) => {
    const value = tuple[side];
    const shown = visibleSides.has(side) && value !== undefined && value !== null;
    const classes = [
      "neighbor-mini-edge",
      `edge-${side.toLowerCase()}`,
      activeSides.has(side) ? "active" : "muted",
      changedSides.has(side) ? "changed" : "",
    ].filter(Boolean).join(" ");
    const badge = badges[side] ? `<b class="neighbor-edge-badge badge-${String(badges[side]).toLowerCase()}">${badges[side]}</b>` : "";
    return `<span class="${classes}" data-side="${side}" data-value="${shown ? value + 1 : ""}">${shown ? cornerColorHtml(value) : ""}${badge}</span>`;
  }).join("");
  const aria = visible
    .filter((side) => tuple[side] !== undefined && tuple[side] !== null)
    .map((side) => `${sideNames[side]} ${tuple[side] + 1}`)
    .join(", ");
  return `<span class="neighbor-mini-face tone-${tone}" data-face-role="${role}" role="img" aria-label="${role}: ${aria}">
    ${edgeHtml}<span class="neighbor-mini-cell">${role}</span>
  </span>`;
}

function swapDirectionsHtml(shift) {
  return SWAP_PAIRS[shift]
    .map(([first, second]) => `<b>${cornerColorHtml(first)}<i>↔</i>${cornerColorHtml(second)}</b>`)
    .join("");
}

function neighborSimpleAHtml(step) {
  const shape = strandType(step.a.after) === "turn" ? "꺾인 선 · ELBOW" : "곧은 선 · STRAIGHT";
  return `
    <p class="neighbor-a-lead"><b>D에서 고른 바꾸기는 A의 왼쪽 변에만</b>, <b>R에서 고른 바꾸기는 A의 위쪽 변에만</b> 적용합니다. 그런 다음 1단계의 6줄 표로 A를 완성합니다.</p>
    <div class="neighbor-a-complete-flow">
      ${miniFaceFigureHtml("원래 A", "A", step.a.source, { active: ["W", "N"], badges: { W: "D", N: "R" }, tone: "a" })}
      <div class="neighbor-a-rule-arrow"><b>→</b><span>D·R에서 고른<br>숫자 바꾸기</span></div>
      ${miniFaceFigureHtml("중간값 · 최종 아님", "A", step.a.prepared, { visible: ["W", "N"], active: ["W", "N"], changed: ["W", "N"], badges: { W: "D", N: "R" }, tone: "a" })}
      <div class="neighbor-a-rule-arrow table-arrow"><b>→</b><span>1단계의<br>6줄 표</span></div>
      <figure class="neighbor-cluster-figure">
        ${neighborFaceClusterHtml(step)}
        <figcaption>A·D·R 결과 · A의 선 모양은 ${shape}</figcaption>
      </figure>
    </div>
    <div class="neighbor-cluster-note">
      <span><b>D·R 배지</b>는 그 변에 적용한 바꾸기입니다.</span>
      <span><b>보라색 고리</b>는 서로 붙은 같은 변입니다.</span>
      <span>숫자는 다른 변으로 이동하지 않습니다.</span>
    </div>`;
}

function neighborFaceClusterHtml(step) {
  const edges = [
    ["a-n", step.a.after.N, false], ["a-w", step.a.after.W, false],
    ["shared-east", step.a.after.E, true], ["shared-south", step.a.after.S, true],
    ["r-n", step.right.after.N, false], ["r-e", step.right.after.E, false], ["r-s", step.right.after.S, false],
    ["d-w", step.down.after.W, false], ["d-e", step.down.after.E, false], ["d-s", step.down.after.S, false],
  ].map(([position, value, shared]) => `<span class="neighbor-cluster-edge edge-${position} ${shared ? "shared" : ""}" data-position="${position}" data-value="${value + 1}">${cornerColorHtml(value)}</span>`).join("");
  return `<div class="neighbor-face-cluster" role="img" aria-label="A는 왼쪽 위, R은 오른쪽, D는 아래에 놓인 두 번째 결과">
    <span class="neighbor-cluster-cell cell-a">A</span>
    <span class="neighbor-cluster-cell cell-r">R</span>
    <span class="neighbor-cluster-cell cell-d">D</span>
    ${edges}
  </div>`;
}

function neighborSoutheastAHtml(step) {
  const shape = strandType(step.a.after) === "turn" ? "꺾인 선 · ELBOW" : "곧은 선 · STRAIGHT";
  return `
    <p class="neighbor-a-lead">아래 ①→②→③이 A에서 실제로 실행되는 순서입니다. <b>②에서는 L·U와 A가 한꺼번에 바뀝니다.</b></p>
    <div class="neighbor-a-algorithm">
      ${southeastAPhaseHtml(1, "A 준비", "이전 결과를 원래 입력 A로 되돌림", step.a.before, step.a.source, faceChangedSides(step.a.before, step.a.source), "첫 칸의 6줄 표를 되돌림")}
      ${southeastAPhaseHtml(2, "L·U와 동시 연결", "L·U의 교환과 공유 변을 한 계산에서 반영", step.a.source, step.a.prepared, faceChangedSides(step.a.source, step.a.prepared), "L은 A의 아래 · U는 A의 오른쪽에 교환 적용")}
      ${southeastAPhaseHtml(3, "A 마무리", "② 직후 A의 아래·오른쪽을 6줄 표에 넣음", step.a.prepared, step.a.after, faceChangedSides(step.a.prepared, step.a.after), "아래·오른쪽에 6줄 표 적용")}
    </div>
    <figure class="neighbor-cluster-figure southeast-cluster">
      ${southeastFaceClusterHtml(step)}
      <figcaption>A·L·U 두 번째 묶음 결과 · A는 ${shape}</figcaption>
    </figure>
    <div class="neighbor-cluster-note">
      <span><b>보라색 고리</b>는 서로 붙은 같은 변입니다.</span>
      <span>금색 테두리는 그 단계에서 실제로 달라진 변입니다.</span>
    </div>`;
}

function southeastAPhaseHtml(number, title, note, before, after, changedSides, rule) {
  return `<article class="neighbor-a-phase" data-neighbor-phase="${number}">
    <header><b>${number}</b><div><strong>${title}</strong><span>${note}</span></div></header>
    <div class="neighbor-phase-flow">
      ${miniFaceFigureHtml(number === 1 ? "이전 단계 A" : number === 2 ? "① 뒤 A" : "② 직후 A", "A", before, { active: ["W", "N", "E", "S"], tone: "a" })}
      <div class="neighbor-phase-arrow"><b>→</b><span>${rule}</span></div>
      ${miniFaceFigureHtml(number === 1 ? "원래 입력 A" : number === 2 ? "② 직후 A" : "③ 뒤 A", "A", after, { active: ["W", "N", "E", "S"], changed: changedSides, tone: "a" })}
    </div>
  </article>`;
}

function southeastFaceClusterHtml(step) {
  const edges = [
    ["a-e-se", step.a.after.E, false], ["a-s-se", step.a.after.S, false],
    ["shared-west-se", step.a.after.W, true], ["shared-north-se", step.a.after.N, true],
    ["l-n-se", step.left.after.N, false], ["l-w-se", step.left.after.W, false], ["l-s-se", step.left.after.S, false],
    ["u-n-se", step.up.after.N, false], ["u-w-se", step.up.after.W, false], ["u-e-se", step.up.after.E, false],
  ].map(([position, value, shared]) => `<span class="neighbor-cluster-edge edge-${position} ${shared ? "shared" : ""}" data-position="${position}" data-value="${value + 1}">${cornerColorHtml(value)}</span>`).join("");
  return `<div class="neighbor-face-cluster southeast" role="img" aria-label="A는 오른쪽 아래, L은 왼쪽, U는 위에 놓인 두 번째 결과">
    <span class="neighbor-cluster-cell cell-u">U</span>
    <span class="neighbor-cluster-cell cell-l">L</span>
    <span class="neighbor-cluster-cell cell-a">A</span>
    ${edges}
  </div>`;
}

function renderStageExplanation(frame) {
  const kind = stageKind(frame);
  const plusFirst = kind === "plus-first";
  const plusSecond = kind === "plus-second";
  const neighborSecond = plusSecond || kind === "minus-second";

  dom.cornerExplainer.hidden = !plusFirst;
  dom.neighborExplainer.hidden = !neighborSecond;
  dom.stageExplainer.hidden = plusFirst || neighborSecond;
  dom.stageExplainer.dataset.kind = kind;
  dom.stageExplainer.dataset.phase = frame.phase;
  dom.stageExplainer.dataset.side = frame.side ?? "";
  dom.stageExplainer.dataset.width = frame.checkpoint ? String(frame.width) : "";

  if (plusFirst || neighborSecond) return;
  if (kind === "input") {
    renderInputStage();
    return;
  }
  if (kind === "interface") {
    renderInterfaceStage();
    return;
  }
  if (kind === "minus-first") {
    renderMinusFirstStage(frame);
    return;
  }
  if (kind === "minus-second") {
    renderMinusSecondStage(frame);
    return;
  }
  if (kind === "band") {
    renderBandStage(frame);
    return;
  }
  if (kind === "empty") {
    renderEmptyStage(frame);
    return;
  }
  renderCompleteStage();
}

function stageKind(frame) {
  if (frame.phase === "input" || frame.phase === "interface" || frame.phase === "complete") return frame.phase;
  if (!frame.checkpoint) return "empty";
  if (frame.phase === "plus" && frame.width === 1) return "plus-first";
  if (frame.phase === "plus" && frame.width === 2) return "plus-second";
  if (frame.phase === "minus" && frame.width === 1) return "minus-first";
  if (frame.phase === "minus" && frame.width === 2) return "minus-second";
  return "band";
}

function setStage({ eyebrow, title, summary, badge, now, change, why, detail = "" }) {
  dom.stageEyebrow.textContent = eyebrow;
  dom.stageExplainerTitle.textContent = title;
  dom.stageSummary.textContent = summary;
  dom.stageBadge.textContent = badge;
  dom.stageBody.innerHTML = `
    <div class="stage-facts">
      ${stageFactHtml("지금", now)}
      ${stageFactHtml("바꿈", change)}
      ${stageFactHtml("왜", why)}
    </div>
    ${detail}`;
}

function stageFactHtml(label, text) {
  return `<article><span>${label}</span><strong>${text}</strong></article>`;
}

function renderInputStage() {
  const validation = state.inputValidation;
  const missing = validation.totalEdges - validation.assignedEdges;
  const invalid = validation.invalidFaces.length;
  if (!validation.ok) {
    const fixingDuplicates = invalid > 0;
    setStage({
      eyebrow: "현재 단계 · 입력",
      title: fixingDuplicates ? "같은 칸에 겹친 숫자를 고칩니다" : "빈 edge에 숫자를 넣습니다",
      summary: fixingDuplicates
        ? `붉은 칸 ${invalid}개에 같은 숫자가 두 번 이상 있습니다.`
        : `${missing}개 edge가 아직 비어 있습니다.`,
      badge: `${validation.assignedEdges}/${validation.totalEdges}개 입력`,
      now: `왼쪽 입력 ${state.source.n ** 2}칸`,
      change: fixingDuplicates ? "붉은 칸의 중복 숫자" : "비어 있는 edge",
      why: "모든 칸의 네 변에 1·2·3·4가 한 번씩 있어야 시작할 수 있음",
      detail: `<p class="stage-note">격자에서 edge를 누른 뒤 1·2·3·4 중 하나를 고르세요. 오른쪽 결과는 입력이 완성된 뒤에 만듭니다.</p>`,
    });
    return;
  }
  setStage({
    eyebrow: "현재 단계 · 입력",
    title: "입력 숫자를 확인합니다",
    summary: `왼쪽 ${state.source.n ** 2}칸이 모두 올바른 입력입니다.`,
    badge: `${state.source.n ** 2}/${state.source.n ** 2}칸 OK`,
    now: "왼쪽 입력 전체",
    change: "아직 바꾸지 않음",
    why: "모든 칸의 네 변에 1·2·3·4가 한 번씩 있는지 먼저 확인함",
    detail: `<p class="stage-note success">확인이 끝났습니다. <b>다음</b>을 누르면 오른쪽 격자를 만들기 시작합니다.</p>`,
  });
}

function renderInterfaceStage() {
  const n = state.source.n;
  setStage({
    eyebrow: "현재 단계 · 대각선",
    title: "가운데 대각선 칸을 그대로 옮깁니다",
    summary: `대각선 ${n}칸의 네 변 숫자를 오른쪽 같은 자리에 복사했습니다.`,
    badge: `${4 * n}개 edge 고정`,
    now: `대각선에 놓인 ${n}칸`,
    change: "각 칸의 네 변 숫자를 그대로 복사",
    why: "금색으로 표시된 이 숫자들은 완성될 때까지 바꾸지 않음",
    detail: `<p class="stage-note locked"><b>금색 칸과 edge는 고정입니다.</b> 이제 그 바깥의 왼쪽 위 영역부터 채웁니다.</p>`,
  });
}

function renderMinusFirstStage(frame) {
  const n = state.source.n;
  const before = faceTuple(frame.previousGrid, n - 1, 0);
  const after = faceTuple(frame.grid, n - 1, 0);
  const shape = strandType(after) === "turn" ? "꺾인 선 · ELBOW" : "곧은 선 · STRAIGHT";
  setStage({
    eyebrow: "현재 단계 · 오른쪽 아래 첫 칸",
    title: "오른쪽 아래의 첫 칸을 만듭니다",
    summary: "이번에는 아래·오른쪽 숫자만 같은 고정표로 바꿉니다.",
    badge: "새 칸 1개",
    now: "가장 바깥 오른쪽 아래 한 칸",
    change: `아래 ${before.S + 1}→${after.S + 1} · 오른쪽 ${before.E + 1}→${after.E + 1}`,
    why: "같은 숫자끼리 두 선으로 이어지게 함",
    detail: `
      <div class="stage-first-transform">
        <article><span>바꾸기 전 A</span><strong class="corner-tuple">${cornerTupleHtml(before)}</strong></article>
        <div class="stage-rule-arrow">
          <span>아래·오른쪽만 표에 넣기</span>
          <strong>${cornerPairHtml(before.S, before.E)}<b>→</b>${cornerPairHtml(after.S, after.E)}</strong>
        </div>
        <article class="after"><span>바꾼 뒤 A</span><strong class="corner-tuple">${cornerTupleHtml(after)}</strong><small>${shape}</small></article>
      </div>
      <p class="stage-note success"><b>왼쪽 ${before.W + 1}과 위 ${before.N + 1}은 그대로</b>이고, 아래·오른쪽 두 숫자만 바뀌었습니다.</p>
      ${n > 2 ? `<p class="stage-note">이것은 <b>이 단계 직후의 값</b>입니다. 더 큰 묶음을 붙일 때 이 칸의 공유 변이 다시 조정될 수 있습니다.</p>` : ""}`,
  });
}

function renderMinusSecondStage(frame) {
  const n = state.source.n;
  const step = secondSoutheastStep(state.source, state.result);
  const aBefore = faceTuple(frame.previousGrid, n - 1, 0);
  const aAfter = faceTuple(frame.grid, n - 1, 0);
  const aChangedSides = faceChangedSides(aBefore, aAfter);
  const sideNames = { W: "왼쪽", N: "위", E: "오른쪽", S: "아래" };
  const aChangeText = aChangedSides.length
    ? `A ${aChangedSides.map((side) => sideNames[side]).join("·")}`
    : "A 최종값은 동일";
  setStage({
    eyebrow: "현재 단계 · 오른쪽 아래 두 번째",
    title: "오른쪽 아래에서 A의 왼쪽 L과 위 U를 붙입니다",
    summary: "L·U를 바꾸면 맞닿은 A의 왼쪽·위도 같은 숫자로 함께 바뀝니다.",
    badge: "새 칸 2개 · A 다시 맞춤",
    now: "먼저 만든 A와 새로 붙일 L·U",
    change: `L·U의 아래·오른쪽 · ${aChangeText}`,
    why: "세 칸의 맞닿는 숫자를 같게 하고, 각 칸에 두 선을 완성함",
    detail: `
      <div class="stage-role-key">
        <span><b>A</b> 바깥 모서리</span><span><b>L</b> A의 왼쪽 칸</span><span><b>U</b> A의 위쪽 칸</span>
      </div>
      <div class="stage-swap-list">
        ${stageSwapRowHtml("L", "아래·오른쪽", step.left.before.S, step.left.before.E, step.left.after.S, step.left.after.E, step.left.shift)}
        ${stageSwapRowHtml("U", "아래·오른쪽", step.up.before.S, step.up.before.E, step.up.after.S, step.up.after.E, step.up.shift)}
        <article class="stage-a-change">
          <div><b>A</b><span>A 전체 비교 · 색 테두리만 실제 변경</span></div>
          <strong class="corner-tuple">${cornerTupleHtml(aBefore)}</strong>
          <i>→</i>
          <strong class="corner-tuple">${cornerTupleHtml(aAfter, aChangedSides)}</strong>
        </article>
      </div>
      <div class="stage-shared-result">
        <span>A 왼쪽 = L 오른쪽 ${colorChangeHtml(step.shared.west.before, step.shared.west.after)}</span>
        <span>A 위 = U 아래 ${colorChangeHtml(step.shared.north.before, step.shared.north.after)}</span>
        <span>A 안쪽 계산 · 아래는 <b>${SWAP_DETAIL[step.left.shift]}</b> 뒤 <b>${SWAP_DETAIL[step.a.shift]}</b> · 오른쪽은 <b>${SWAP_DETAIL[step.up.shift]}</b> 뒤 <b>${SWAP_DETAIL[step.a.shift]}</b></span>
      </div>
      <p class="stage-note">A 행은 화면의 <b>첫 칸 결과 → 이번 결과</b> 비교입니다. 계산은 원래 입력 A·L·U에서 다시 시작하며, 위에 적힌 실제 숫자 교환을 그대로 적용합니다.</p>
      ${n > 3 ? `<p class="stage-note">이것은 <b>두 번째 묶음 직후의 값</b>입니다. 다음 묶음을 붙일 때 A·L·U의 공유 변이 다시 조정될 수 있습니다.</p>` : ""}`,
  });
}

function stageSwapRowHtml(role, pairName, beforeFirst, beforeSecond, afterFirst, afterSecond, shift) {
  return `<article class="stage-swap-row" data-stage-swap="${shift}">
    <div><b>${role}</b><span>${pairName}</span></div>
    <strong>${cornerPairHtml(beforeFirst, beforeSecond)}</strong>
    <i>→</i>
    <mark><b>${SWAP_DETAIL[shift]}</b><small>두 쌍을 동시에 바꿈</small></mark>
    <i>→</i>
    <strong>${cornerPairHtml(afterFirst, afterSecond)}</strong>
  </article>`;
}

function renderBandStage(frame) {
  const model = bandStageModel(frame);
  const sideName = frame.side === "+" ? "왼쪽 위" : "오른쪽 아래";
  const last = frame.segmentIndex === frame.totalSegments - 1;
  const selected = model.selected;
  const macroCopy = {
    1: {
      title: "① 먼저 · 안쪽 칸 바꾸기",
      action: `먼저, 이미 있는 안쪽 칸을 바꿉니다. 새 ${frame.width}칸은 아직 붙이지 않습니다.`,
      map: "‘먼저 바꿈’인 칸이 지금 달라집니다. 흐린 칸은 다음 단계에서 붙일 새 줄입니다.",
      footer: `안쪽 칸을 먼저 바꿨습니다. 다음은 새 ${frame.width}칸을 붙일 차례입니다.`,
    },
    2: {
      title: `② 다음 · 새 ${frame.width}칸 붙이기`,
      action: "다음, 금색 새 줄을 붙이고 맞닿은 보라색 칸도 한꺼번에 바꿉니다.",
      map: "‘지금 붙임’인 금색 칸과 ‘같이 바꿈’인 보라색 칸은 같은 순간에 바뀝니다.",
      footer: `새 ${frame.width}칸과 맞닿은 칸을 함께 바꿨습니다. 이제 남은 안쪽 칸만 끝내면 됩니다.`,
    },
    3: {
      title: "③ 마지막 · 남은 안쪽 칸 끝내기",
      action: "마지막으로 ‘마저 바꿈’인 안쪽 칸을 바꾸면 이번 묶음이 끝납니다.",
      map: "모든 칸이 꺾인 선 또는 곧은 선이 되었습니다. 진한 칸은 이번 단계에서 실제 숫자가 달라진 칸입니다.",
      footer: `새 ${frame.width}칸과 안쪽 ${model.oldCount}칸, 모두 ${last ? "이 영역의 최종" : "현재"} 선 모양이 되었습니다${last ? "." : ". 다음 묶음에서 다시 바뀔 수 있습니다."}`,
    },
  }[model.macroStep];
  dom.stageEyebrow.textContent = `현재 단계 · ${sideName} · ${frame.segmentIndex + 1}/${frame.totalSegments}번째 묶음`;
  dom.stageExplainerTitle.textContent = `${sideName} · ${macroCopy.title}`;
  dom.stageSummary.textContent = macroCopy.action;
  dom.stageBadge.textContent = `새 ${frame.width}칸${last ? " · 이 영역 마지막 묶음" : ""}`;
  dom.stageBody.innerHTML = `
    <div class="band-order" aria-label="이번 줄의 실제 계산 순서">
      ${bandOrderCardHtml(1, "안쪽 칸부터 바꾸기", "먼저", "새 칸은 아직 붙이지 않습니다.", model.macroStep === 1)}
      <b class="band-order-arrow" aria-hidden="true">→</b>
      ${bandOrderCardHtml(2, `새 ${frame.width}칸 붙이기`, "다음 · 함께", "새 칸과 맞닿은 칸을 한꺼번에 바꿉니다.", model.macroStep === 2)}
      <b class="band-order-arrow" aria-hidden="true">→</b>
      ${bandOrderCardHtml(3, "남은 안쪽 칸 끝내기", "마지막", "여기까지 하면 이번 묶음이 끝납니다.", model.macroStep === 3)}
    </div>
    <div class="band-workspace">
      <section class="band-map-card">
        <header>
          <div><span>${macroCopy.title}</span><strong>진하게 표시된 칸을 누르면 숫자의 전·후가 크게 보입니다</strong></div>
          ${bandActionLegendHtml(model.macroStep)}
        </header>
        ${bandBlockMapHtml(model)}
        <p>${macroCopy.map}</p>
      </section>
      ${model.macroStep === 2 && selected.role === "new"
        ? bandNewFaceInspectorHtml(model, selected)
        : bandMacroFaceInspectorHtml(model, selected)}
    </div>
    <div class="band-finish ${model.macroStep === 3 && model.complete ? "complete" : "band-progress"}">
      <strong>${macroCopy.title}</strong><span>${macroCopy.footer}</span>
    </div>`;
}

function bandStageModel(frame) {
  const baseFrame = frame.baseFrame ?? frame;
  const mainIndex = bandMainIndex(baseFrame);
  if (mainIndex < 0) throw new Error(`${frame.width}칸을 붙이는 중심 계산을 찾지 못했습니다.`);
  const mainStep = baseFrame.primitiveSteps[mainIndex];
  const macroStep = frame.bandMacroStep ?? 2;
  const width = frame.width;
  const baseOffset = frame.checkpoint.rowOffset;
  const blockFaces = [];
  for (let layer = 0; layer < width; layer += 1) {
    const rowOffset = baseOffset + layer;
    for (let index = 0; index < width - layer; index += 1) {
      const { x, y } = halfEntryFaceCoordinates(frame.side, rowOffset, index);
      const key = faceKey(x, y);
      const visits = frame.primitiveSteps.flatMap((step) => {
        const touched = step.touchedFaces.find((face) => face.key === key);
        return touched ? [{ ...touched, step }] : [];
      });
      blockFaces.push({
        key,
        x,
        y,
        rowOffset,
        layer,
        index,
        role: layer === 0 ? "new" : "old",
        available: macroStep !== 1 || layer !== 0,
        newIndex: layer === 0 ? index : null,
        before: faceTuple(frame.previousGrid, x, y),
        after: faceTuple(frame.grid, x, y),
        visits,
        mapRow: frame.side === "+" ? width - (y - (baseOffset + 1)) : width - y,
        mapColumn: frame.side === "+" ? x + 1 : x - (baseOffset + 1) + 1,
      });
    }
  }
  blockFaces.sort((left, right) => left.mapRow - right.mapRow || left.mapColumn - right.mapColumn);
  let oldIndex = 0;
  blockFaces.forEach((face) => {
    if (face.role === "old") face.oldIndex = ++oldIndex;
  });
  const requestedKey = state.bandSelection?.frameIndex === state.frameIndex
    && state.bandSelection?.macroStep === macroStep
    ? state.bandSelection.faceKey
    : null;
  const defaultFace = macroStep === 2
    ? blockFaces.find(({ role, newIndex }) => role === "new" && newIndex === 0)
    : blockFaces.find(({ role, visits }) => role === "old" && visits.length)
      ?? blockFaces.find(({ role }) => role === "old")
      ?? blockFaces.find(({ available }) => available);
  const selected = blockFaces.find(({ key, available }) => available && key === requestedKey) ?? defaultFace;
  state.bandSelection = { frameIndex: state.frameIndex, macroStep, faceKey: selected.key };
  const newFaces = mainStep.event.sourceTop.map((pair, index) => {
    const { x, y } = halfEntryFaceCoordinates(frame.side, baseOffset, index);
    const shift = mainStep.event.shifts[index];
    const constraints = bandShiftConstraints(mainStep.event, index, frame.side);
    const candidates = [1, 2, 3].map((candidate) => ({
      shift: candidate,
      valid: constraints.every(({ pair: values }) => pairBecomesComplement(values, candidate)),
    }));
    const firstValid = candidates.find(({ valid }) => valid)?.shift;
    if (firstValid !== shift) throw new Error(`새 칸 ${index + 1}의 숫자 바꾸기 근거가 trace와 맞지 않습니다.`);
    return {
      key: faceKey(x, y),
      x,
      y,
      index,
      shift,
      constraints,
      candidates,
      before: faceTuple(mainStep.beforeGrid, x, y),
      after: faceTuple(mainStep.afterGrid, x, y),
      sourcePair: pair,
      targetPair: mainStep.event.targetTop[index],
    };
  });
  return {
    frame,
    baseFrame,
    macroStep,
    width,
    mainIndex,
    mainStep,
    prepareSteps: baseFrame.primitiveSteps.slice(0, mainIndex),
    finishSteps: baseFrame.primitiveSteps.slice(mainIndex + 1),
    blockFaces,
    newFaces,
    oldCount: width * (width - 1) / 2,
    selected,
    complete: macroStep === 3 && blockFaces.every(({ after }) => Boolean(strandType(after))),
  };
}

function bandShiftConstraints(event, index, side) {
  const activePair = side === "+" ? "왼쪽·위" : "아래·오른쪽";
  const constraints = [{
    label: `선택한 새 칸의 ${activePair}`,
    pair: [event.sourceTop[index].l, event.sourceTop[index].v],
  }];
  if (index > 0) {
    constraints.push({
      label: "왼쪽에서 맞닿는 두 숫자",
      pair: [event.sourceTop[index].l, event.sourceMiddle[index - 1].v],
    });
  }
  if (index < event.sourceMiddle.length) {
    constraints.push({
      label: "오른쪽에서 맞닿는 두 숫자",
      pair: [event.sourceTop[index].v, event.sourceMiddle[index].l],
    });
  }
  return constraints;
}

function pairBecomesComplement([first, second], shift) {
  const source = new Set([first, second]);
  const remaining = [0, 1, 2, 3].filter((value) => !source.has(value)).sort();
  const shifted = [first ^ shift, second ^ shift].sort();
  return remaining.length === 2 && shifted[0] === remaining[0] && shifted[1] === remaining[1];
}

function bandOrderCardHtml(number, title, meta, description, current = false) {
  return `<button type="button" class="band-order-card ${current ? "current" : ""}" data-band-step="${number}" ${current ? 'aria-current="step"' : ""}>
    <b>${number}</b><div><span>${title}</span><strong>${meta}</strong><small>${description}</small></div>
  </button>`;
}

function bandActionLegendHtml(step) {
  const items = {
    1: [["affected", "↻", "지금 먼저 바꿈"], ["waiting", "＋", "다음에 붙임"]],
    2: [["joining", "＋", "지금 붙임"], ["affected", "↻", "같이 바꿈"]],
    3: [["affected", "↻", "지금 마저 바꿈"], ["joined", "✓", "붙이기 끝"]],
  }[step];
  return `<div class="band-map-legend" aria-label="지도 기호 뜻">${items.map(([role, symbol, text]) => `
    <span><i class="${role}" aria-hidden="true">${symbol}</i>${text}</span>`).join("")}</div>`;
}

function bandBlockMapHtml(model) {
  return `<div class="band-block-map" style="--band-width:${model.width}" role="group" aria-label="새 칸과 기존 칸의 위치">
    ${model.blockFaces.map((face) => {
      const selected = face.key === model.selected.key;
      const shape = face.available ? strandType(face.after) : null;
      const positionLabel = face.role === "new" ? `왼쪽부터 ${face.newIndex + 1}번째 새 칸` : `지도에서 ${face.oldIndex}번째 안쪽 칸`;
      const label = face.role === "new" ? "새 칸" : "안쪽 칸";
      const action = model.frame.bandActionRoles?.get(face.key) ?? "quiet";
      const status = bandMapFaceStatus(model, face);
      return `<button type="button" class="band-map-face ${face.role} action-${action} ${selected ? "selected" : ""} ${face.available ? "" : "ghost"}"
          style="grid-row:${face.mapRow};grid-column:${face.mapColumn}"
          data-band-face="${face.key}" data-x="${face.x}" data-y="${face.y}"
          data-role="${face.role}" data-visits="${face.visits.length}" data-shape="${shape ?? ""}"
          data-action="${action}" data-change="${status.change}" ${face.available ? "" : "disabled"} aria-pressed="${selected}"
          aria-label="${positionLabel}, ${status.long}">
        <span>${label}</span>${face.available ? bandStrandIconHtml(face.after) : `<span class="band-intermediate-icon">②</span>`}
        <small class="band-map-status"><span>${status.long}</span><b aria-hidden="true">${status.short}</b></small>
      </button>`;
    }).join("")}
  </div>`;
}

function bandMapFaceStatus(model, face) {
  if (!face.available) return { change: "pending", long: "다음에 붙임", short: "다음" };
  const changed = faceChangedSides(face.before, face.after).length > 0;
  if (face.visits.length && !changed) return { change: "returned", long: "바뀌고 돌아옴", short: "↻ 같음" };
  if (changed) {
    if (model.macroStep === 1) return { change: "changed", long: "먼저 바꿈", short: "먼저" };
    if (model.macroStep === 2 && face.role === "new") return { change: "changed", long: "지금 붙임", short: "붙임" };
    if (model.macroStep === 2) return { change: "changed", long: "같이 바꿈", short: "같이" };
    return { change: "changed", long: "마저 바꿈", short: "마저" };
  }
  if (model.macroStep === 3 && face.role === "new") return { change: "unchanged", long: "이미 완성", short: "완성" };
  return { change: "unchanged", long: "이번엔 그대로", short: "그대로" };
}

function bandStrandIconHtml(tuple) {
  const type = strandType(tuple);
  if (type === "straight") {
    return `<svg class="band-strand-icon" viewBox="0 0 40 40" aria-hidden="true">
      <path class="value-${tuple.W}" d="M2 20 L38 20"></path>
      <path class="value-${tuple.N}" d="M20 2 L20 38"></path>
    </svg>`;
  }
  if (type === "turn") {
    return `<svg class="band-strand-icon" viewBox="0 0 40 40" aria-hidden="true">
      <path class="value-${tuple.W}" d="M2 20 C12 20 20 28 20 38"></path>
      <path class="value-${tuple.N}" d="M20 2 C20 12 28 20 38 20"></path>
    </svg>`;
  }
  return `<svg class="band-strand-icon incomplete" viewBox="0 0 40 40" aria-label="아직 이어지지 않은 네 선">
    <path class="value-${tuple.W}" d="M2 20 L12 20"></path>
    <path class="value-${tuple.N}" d="M20 2 L20 12"></path>
    <path class="value-${tuple.E}" d="M28 20 L38 20"></path>
    <path class="value-${tuple.S}" d="M20 28 L20 38"></path>
    <circle cx="20" cy="20" r="3"></circle>
  </svg>`;
}

function bandNewFaceInspectorHtml(model, selected) {
  const face = model.newFaces.find(({ key }) => key === selected.key);
  if (!face) throw new Error("선택한 새 칸의 계산을 찾지 못했습니다.");
  const activeSides = model.frame.side === "+" ? ["W", "N"] : ["S", "E"];
  const pairName = model.frame.side === "+" ? "왼쪽·위" : "아래·오른쪽";
  const unchangedName = model.frame.side === "+" ? "오른쪽·아래" : "왼쪽·위";
  const shape = strandType(face.after);
  const shapeText = shape === "turn" ? "꺾인 선 (ELBOW)" : "곧은 선 (STRAIGHT)";
  const last = model.frame.segmentIndex === model.frame.totalSegments - 1;
  const resultScope = last ? "② 직후 값 · 이 영역에서는 최종" : "② 직후 값 · 이후 다시 조정될 수 있음";
  const validCount = face.candidates.filter(({ valid }) => valid).length;
  return `<section class="band-inspector new" data-selected-role="new" data-x="${face.x}" data-y="${face.y}" data-shift="${face.shift}">
    <header><div><span>② · 선택한 새 칸</span><strong>붙이기 전 → 숫자 두 쌍 바꾸기 → 붙인 뒤</strong></div><b>${shapeText}</b></header>
    <div class="band-face-flow" data-before="${tupleData(face.before)}" data-after="${tupleData(face.after)}">
      ${miniFaceFigureHtml("붙이기 전", "선택한 새 칸", face.before, { active: activeSides, tone: `band-${model.frame.side === "+" ? "plus" : "minus"}` })}
      <b class="band-face-arrow" aria-hidden="true">→</b>
      <div class="band-applied-swap"><span>${pairName}에 동시에 적용</span><strong>${swapDirectionsHtml(face.shift)}</strong><small>${SWAP_DETAIL[face.shift]}</small></div>
      <b class="band-face-arrow" aria-hidden="true">→</b>
      ${miniFaceFigureHtml(resultScope, "선택한 새 칸", face.after, { active: activeSides, changed: activeSides, tone: `band-${model.frame.side === "+" ? "plus" : "minus"}` })}
    </div>
    <p class="band-result-sentence"><b>${pairName} 두 숫자만 위 바꾸기로 변하고</b>, ${unchangedName} 두 숫자는 그대로입니다. 결과는 <b>${shapeText}</b>입니다.</p>
    <div class="band-rule-evidence">
      <header><div><span>왜 이 바꾸기인가?</span><strong>세 바꾸기를 위에서부터 검사합니다</strong></div><p>보이는 숫자 묶음을 각각 ‘남은 두 숫자’로 보내는지 확인하고, 처음 통과한 바꾸기를 씁니다.</p></header>
      <div class="band-constraint-pairs">
        ${face.constraints.map(({ label, pair }) => bandConstraintPairHtml(label, pair)).join("")}
      </div>
      <div class="band-candidate-list">
        ${face.candidates.map((candidate) => bandCandidateHtml(candidate, face)).join("")}
      </div>
      <p class="band-rule-note">이 입력에서는 ${validCount}개가 조건을 통과합니다. 고정 순서에서 가장 먼저 나오는 <b>${SWAP_DETAIL[face.shift]}</b> 바꾸기를 선택했습니다.</p>
    </div>
  </section>`;
}

function bandConstraintPairHtml(label, pair) {
  const source = new Set(pair);
  const remaining = [0, 1, 2, 3].filter((value) => !source.has(value));
  return `<span data-source="${pair.map((value) => value + 1).join(",")}" data-target="${remaining.map((value) => value + 1).join(",")}">
    <small>${label}</small><strong>${cornerPairHtml(pair[0], pair[1])}<i>→ 남은</i>${cornerPairHtml(remaining[0], remaining[1])}</strong>
  </span>`;
}

function bandCandidateHtml(candidate, face) {
  const selected = candidate.shift === face.shift;
  const status = selected ? "사용" : candidate.valid ? "가능 · 후순위" : "탈락";
  return `<article class="band-candidate ${selected ? "selected" : candidate.valid ? "valid" : "invalid"}"
      data-candidate-shift="${candidate.shift}" data-valid="${candidate.valid}" data-selected="${selected}">
    <span>${["첫", "두", "세"][candidate.shift - 1]} 번째</span><strong>${swapDirectionsHtml(candidate.shift)}</strong><small>${SWAP_DETAIL[candidate.shift]}</small><b>${status}</b>
  </article>`;
}

function bandMacroFaceInspectorHtml(model, selected) {
  const changedSides = faceChangedSides(selected.before, selected.after);
  const changedNames = changedSides.map((side) => ({ W: "왼쪽", N: "위", E: "오른쪽", S: "아래" }[side]));
  const netSame = changedSides.length === 0;
  const roleLabel = selected.role === "new" ? "선택한 새 칸" : "선택한 안쪽 칸";
  const macroLabel = { 1: "① 먼저 바꾸기", 2: "② 함께 바꾸기", 3: "③ 마저 바꾸기" }[model.macroStep];
  const tone = selected.role === "new" ? `band-${model.frame.side === "+" ? "plus" : "minus"}` : "band-old";
  const noChangeReason = selected.role === "new" && model.macroStep === 3
    ? "이 새 칸은 앞 단계에서 완성되어 이번에는 그대로입니다."
    : "이번 단계에서는 이 칸을 건드리지 않습니다.";
  const headerText = !netSame
    ? "색 테두리가 있는 숫자만 바뀝니다."
    : selected.visits.length
      ? "중간에는 바뀌지만 마지막 숫자는 처음과 같습니다."
      : noChangeReason;
  return `<section class="band-inspector ${selected.role}" data-selected-role="${selected.role}" data-x="${selected.x}" data-y="${selected.y}" data-visits="${selected.visits.length}">
    <header><div><span>${macroLabel} · ${roleLabel}</span><strong>${headerText}</strong></div><b>${netSame ? "끝값은 같음" : `${changedNames.join("·")} 변경`}</b></header>
    <div class="band-face-flow compact" data-before="${tupleData(selected.before)}" data-after="${tupleData(selected.after)}">
      ${miniFaceFigureHtml(`${macroLabel} 전`, roleLabel, selected.before, { active: ["W", "N", "E", "S"], tone })}
      <b class="band-face-arrow" aria-hidden="true">→</b>
      ${miniFaceFigureHtml(`${macroLabel} 후`, roleLabel, selected.after, { active: ["W", "N", "E", "S"], changed: changedSides, tone })}
    </div>
    <p class="band-result-sentence">${netSame
      ? selected.visits.length ? "전과 후를 비교하면 숫자는 같습니다. 중간에 달라졌다가 다시 돌아온 과정은 아래에서 볼 수 있습니다." : noChangeReason
      : `전·후를 비교하면 ${changedNames.join("·")} 숫자가 달라집니다.`}</p>
    ${selected.visits.length ? `
    <details class="band-full-history">
      <summary>중간에 어떻게 바뀌었는지 순서대로 보기</summary>
      <p>펼친 뒤 왼쪽부터 보면 됩니다. 같은 카드 안의 숫자는 한꺼번에 바뀝니다.</p>
      <div class="band-visit-track">${selected.visits.map((visit, index) => bandVisitHtml(visit, index, model.mainIndex)).join("")}</div>
    </details>` : ""}
  </section>`;
}

function bandVisitHtml(visit, index, mainIndex) {
  const position = visit.step.primitiveIndex < mainIndex
    ? "붙이기 전"
    : visit.step.primitiveIndex === mainIndex
      ? "새 줄 연결"
      : "붙인 뒤";
  const operation = visit.step.event.type === "alpha-base"
    ? "한 칸 고정표"
    : `${visit.step.event.width}칸 동시 맞춤`;
  return `<article class="band-visit" data-primitive-index="${visit.step.primitiveIndex}"
      data-phase="${position}" data-direct="${visit.direct}"
      data-before="${tupleData(visit.before)}" data-after="${tupleData(visit.after)}">
    <header><b>${index + 1}</b><div><span>${position}</span><strong>${operation}</strong></div></header>
    <div>${visit.changedSides.map((side) => bandVisitSideHtml(side, visit.before[side], visit.after[side])).join("")}</div>
    <small>${visit.direct ? "이 계산에 직접 포함" : "붙은 변이 함께 변경"}</small>
  </article>`;
}

function bandVisitSideHtml(side, before, after) {
  const name = { W: "왼", N: "위", E: "오", S: "아래" }[side];
  return `<span><b>${name}</b>${colorChangeHtml(before, after)}</span>`;
}

function tupleData(tuple) {
  return [tuple.W, tuple.N, tuple.E, tuple.S].map((value) => value + 1).join(",");
}

function renderEmptyStage(frame) {
  const sideName = frame.side === "+" ? "왼쪽 위" : "오른쪽 아래";
  setStage({
    eyebrow: `현재 단계 · ${sideName}`,
    title: `${sideName}에는 바꿀 칸이 없습니다`,
    summary: "n=1에서는 대각선 한 칸이 격자 전체입니다.",
    badge: "변경 0개",
    now: `${sideName} 영역`,
    change: "아무 숫자도 바꾸지 않음",
    why: "대각선 밖의 칸이 하나도 없음",
    detail: `<p class="stage-note success"><b>건너뜁니다.</b> 다음 단계로 이동해도 격자 숫자는 그대로입니다.</p>`,
  });
}

function renderCompleteStage() {
  const n = state.source.n;
  setStage({
    eyebrow: "현재 단계 · 완성",
    title: "오른쪽 결과가 완성되었습니다",
    summary: `오른쪽 ${n ** 2}칸이 모두 완성되었습니다.`,
    badge: state.roundTripOk ? "되돌리기 확인 완료" : "검증 필요",
    now: "완성된 오른쪽 전체 격자",
    change: "더 바꿀 숫자 없음",
    why: "대각선 칸은 그대로이고, 나머지 모든 칸에는 두 선이 완성됨",
    detail: `<div class="stage-complete-checks">
      <span>✓ 대각선 ${n}칸 그대로</span>
      <span>✓ 나머지 ${n * (n - 1)}칸에 두 선</span>
      <span>${state.roundTripOk ? "✓" : "!"} 이 결과에서 원래 입력으로 되돌아감</span>
    </div>`,
  });
}

function setNeighborUnavailable(status, explanation) {
  dom.neighborLive.classList.add("unavailable");
  dom.neighborStatus.textContent = status;
  dom.neighborBeforeDiagram.innerHTML = `<div class="neighbor-empty">계산 대기</div>`;
  dom.neighborAfterDiagram.innerHTML = `<div class="neighbor-empty">계산 대기</div>`;
  [dom.neighborDownStep, dom.neighborRightStep, dom.neighborAStep].forEach((node) => {
    node.innerHTML = `<div class="neighbor-empty">계산 대기</div>`;
  });
  dom.neighborExplanation.hidden = false;
  dom.neighborExplanation.textContent = explanation;
}

function resetNeighborRuleHighlights() {
  document.querySelectorAll("[data-next-rule], [data-kind-column], [data-kind-row]").forEach((node) => {
    node.classList.remove("current", "used-down", "used-right");
    node.removeAttribute("data-used-by");
  });
}

function highlightNeighborRule(kind, referenceKind, role) {
  document.querySelector(`[data-kind-column="${referenceKind}"]`)?.classList.add("current");
  const cell = document.querySelector(`[data-next-rule="${kind}-${referenceKind}"]`);
  const row = document.querySelector(`[data-kind-row="${kind}"]`);
  const roleClass = role === "D" || role === "L" ? "used-down" : "used-right";
  [row, cell].forEach((node) => {
    if (!node) return;
    node.classList.add("current", roleClass);
    const used = new Set((node.dataset.usedBy ?? "").split("·").map((value) => value.trim()).filter(Boolean));
    used.add(role);
    node.dataset.usedBy = [...used].join("·");
  });
}

function stateDiagramHtml(step, phase) {
  const after = phase === "after";
  const a = after ? step.a.after : step.a.before;
  const down = after ? step.down.after : step.down.before;
  const right = after ? step.right.after : step.right.before;
  return [
    stateFaceHtml("A", after ? "2단계 결과" : "1단계 결과", [
      ["왼쪽", a.W, false],
      ["위", a.N, false],
      ["아래", a.S, true],
      ["오른쪽", a.E, true],
    ], "a", false),
    stateFaceHtml("R", after ? "2단계 결과" : "원래 입력", [
      ["왼쪽", right.W, true],
      ["위", right.N, false],
    ], "r", !after),
    stateFaceHtml("D", after ? "2단계 결과" : "원래 입력", [
      ["왼쪽", down.W, false],
      ["위", down.N, true],
    ], "d", !after),
  ].join("");
}

function southeastStateDiagramHtml(step, phase) {
  const after = phase === "after";
  const a = after ? step.a.after : step.a.before;
  const left = after ? step.left.after : step.left.before;
  const up = after ? step.up.after : step.up.before;
  return [
    stateFaceHtml("A", after ? "2단계 결과" : "1단계 결과", [
      ["왼쪽", a.W, true], ["위", a.N, true], ["아래", a.S, false], ["오른쪽", a.E, false],
    ], "a", false),
    stateFaceHtml("L", after ? "2단계 결과" : "원래 입력", [
      ["오른쪽", left.E, true], ["아래", left.S, false],
    ], "l", !after),
    stateFaceHtml("U", after ? "2단계 결과" : "원래 입력", [
      ["아래", up.S, true], ["오른쪽", up.E, false],
    ], "u", !after),
  ].join("");
}

function stateFaceHtml(letter, label, values, position, pending) {
  const valueRows = values.map(([side, value, shared]) => `
    <span class="state-face-value ${shared ? "shared" : ""}"><small>${side}</small>${cornerColorHtml(value)}</span>
  `).join("");
  return `<div class="state-face face-${position} ${pending ? "input-value" : ""}">
    <span class="state-face-title"><b>${letter}</b><small>${label}</small></span>
    <span class="state-face-values">${valueRows}</span>
  </div>`;
}

function colorChangeHtml(before, after) {
  return `<span class="color-change">${cornerColorHtml(before)}<b>→</b>${cornerColorHtml(after)}</span>`;
}

function cornerTupleHtml({ W, N, E, S }, changedSides = []) {
  const changed = new Set(changedSides);
  return [
    ["W", "왼쪽", W], ["N", "위", N], ["E", "오른쪽", E], ["S", "아래", S],
  ].map(([side, label, value]) => `<span class="${changed.has(side) ? "changed" : ""}"><b>${label}</b>${cornerColorHtml(value)}</span>`).join("");
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

function setGridEdgeValue(grid, key, value) {
  const [kind, yText, xText] = key.split(":");
  grid[kind][Number(yText)][Number(xText)] = value;
}

function selectExplainedEdge(key) {
  const frame = presentationFrame(state.frames[state.frameIndex]);
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
      const bandAction = frame.bandActionRoles?.get(faceKey(x, y)) ?? "";
      const inputClass = target ? "" : inputFaceClass(x, y);
      const firstCorner = !target && grid.n > 1 && x === 0 && y === grid.n - 1;
      const nextFace = !target && grid.n > 2
        ? x === 0 && y === grid.n - 2 ? "down"
          : x === 1 && y === grid.n - 1 ? "right"
            : ""
        : "";
      const sx = margin + x * cell;
      const sy = margin + (grid.n - 1 - y) * cell;
      svg.append(svgEl("rect", {
        class: `face-region ${region} ${visible ? "" : "hidden"} ${activeFace && !bandAction ? "process-active" : ""} ${bandAction ? `band-${bandAction}` : ""} ${inputClass} ${firstCorner ? "first-corner" : ""} ${nextFace ? `next-rule-face next-${nextFace}` : ""}`,
        x: sx + 1, y: sy + 1, width: cell - 2, height: cell - 2, rx: Math.min(12, cell * .08),
        "data-x": x,
        "data-y": y,
        "data-face-key": faceKey(x, y),
        "data-band-action": bandAction,
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
      if (firstCorner && cell > 74) addText(svg, cx, cy + 3, "A · 첫 칸", "first-corner-label");
      if (nextFace && cell > 74) addText(svg, cx, cy + 3, nextFace === "down" ? "D · 아래" : "R · 오른쪽", `next-rule-label next-${nextFace}`);
      if (bandAction && bandAction !== "quiet" && cell > 74) {
        const symbol = { waiting: "＋", joining: "＋", affected: "↻", joined: "✓" }[bandAction];
        addText(svg, sx + Math.min(18, cell * .17), sy + Math.min(21, cell * .2), symbol, `band-action-label band-${bandAction}`);
      }
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
    "data-edge-key": key,
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
  const bandStep = isBandFrame(state.frames[state.frameIndex]) ? currentBandStep(state.frames[state.frameIndex]) : 1;
  url.hash = `g=${encodeGrid(state.source)}&f=${state.frameIndex}&b=${bandStep}&e=${state.editing ? 1 : 0}`;
  history.replaceState(null, "", url);
}

function loadFrameIndex() {
  const value = Number(new URLSearchParams(location.hash.slice(1)).get("f"));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function loadBandMacroStep() {
  const value = Number(new URLSearchParams(location.hash.slice(1)).get("b"));
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
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
