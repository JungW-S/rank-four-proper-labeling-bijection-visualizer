import {
  DEFAULT_ORDER,
  ELEMENTS,
  add,
  applyDiamond,
  complementPair,
  normalizePair,
  omega,
  pairEquals,
} from "./bijection.mjs";

export function createGrid(n) {
  return {
    n,
    h: Array.from({ length: n + 1 }, () => Array(n).fill(null)),
    v: Array.from({ length: n }, () => Array(n + 1).fill(null)),
  };
}

export function cloneGrid(grid) {
  return {
    n: grid.n,
    h: grid.h.map((row) => [...row]),
    v: grid.v.map((row) => [...row]),
  };
}

export function gridsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function faceTuple(grid, x, y) {
  return {
    W: grid.v[y][x],
    N: grid.h[y + 1][x],
    E: grid.v[y][x + 1],
    S: grid.h[y][x],
  };
}

export function faceValues(grid, x, y) {
  const { W, N, E, S } = faceTuple(grid, x, y);
  return [W, N, E, S];
}

export function strandType(tuple) {
  const { W, N, E, S } = tuple;
  if (W === S && N === E && W !== N) return "turn";
  if (W === E && N === S && W !== N) return "straight";
  return null;
}

function validateShape(grid, { allowNull = false } = {}) {
  const errors = [];
  const { n } = grid ?? {};
  if (!Number.isInteger(n) || n < 1) return ["grid.n은 양의 정수여야 합니다."];
  if (!Array.isArray(grid.h) || grid.h.length !== n + 1) errors.push("horizontal edge 배열 크기가 잘못되었습니다.");
  if (!Array.isArray(grid.v) || grid.v.length !== n) errors.push("vertical edge 배열 크기가 잘못되었습니다.");
  if (errors.length) return errors;

  grid.h.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== n) errors.push(`h[${y}]의 길이가 잘못되었습니다.`);
  });
  grid.v.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== n + 1) errors.push(`v[${y}]의 길이가 잘못되었습니다.`);
  });

  for (const row of [...grid.h, ...grid.v]) {
    for (const value of row) {
      if (!ELEMENTS.includes(value) && !(allowNull && value === null)) {
        errors.push(allowNull
          ? "모든 edge label은 0,1,2,3 또는 null이어야 합니다."
          : "모든 edge label은 0,1,2,3 중 하나여야 합니다.");
      }
    }
  }
  return errors;
}

export function validatePartialE(grid) {
  const errors = validateShape(grid, { allowNull: true });
  if (errors.length) {
    return {
      ok: false,
      complete: false,
      errors,
      assignedEdges: 0,
      totalEdges: 0,
      properFaces: 0,
      invalidFaces: [],
      incompleteFaces: [],
    };
  }

  const invalidFaces = [];
  const incompleteFaces = [];
  let properFaces = 0;
  for (let y = 0; y < grid.n; y += 1) {
    for (let x = 0; x < grid.n; x += 1) {
      const tuple = faceTuple(grid, x, y);
      const entries = Object.entries(tuple).filter(([, value]) => value !== null);
      const byValue = new Map();
      entries.forEach(([side, value]) => {
        if (!byValue.has(value)) byValue.set(value, []);
        byValue.get(value).push(side);
      });
      const duplicates = [...byValue.entries()]
        .filter(([, sides]) => sides.length > 1)
        .map(([value, sides]) => ({ value, sides }));
      if (duplicates.length) {
        invalidFaces.push({ x, y, duplicates });
      } else if (entries.length < 4) {
        incompleteFaces.push({ x, y, missing: 4 - entries.length });
      } else {
        properFaces += 1;
      }
    }
  }

  const totalEdges = 2 * grid.n * (grid.n + 1);
  const assignedEdges = [...grid.h, ...grid.v].flat().filter((value) => value !== null).length;
  const complete = assignedEdges === totalEdges;
  return {
    ok: complete && invalidFaces.length === 0 && properFaces === grid.n * grid.n,
    complete,
    errors: [],
    assignedEdges,
    totalEdges,
    properFaces,
    invalidFaces,
    incompleteFaces,
  };
}

export function validateE(grid) {
  const errors = validateShape(grid);
  if (errors.length) return { ok: false, errors };
  for (let y = 0; y < grid.n; y += 1) {
    for (let x = 0; x < grid.n; x += 1) {
      if (new Set(faceValues(grid, x, y)).size !== 4) {
        errors.push(`E: face (${x},${y})가 proper가 아닙니다.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateD(grid) {
  const errors = validateShape(grid);
  if (errors.length) return { ok: false, errors };
  for (let y = 0; y < grid.n; y += 1) {
    for (let x = 0; x < grid.n; x += 1) {
      const tuple = faceTuple(grid, x, y);
      if (x === y) {
        if (new Set(Object.values(tuple)).size !== 4) {
          errors.push(`D: diagonal face (${x},${y})가 proper가 아닙니다.`);
        }
      } else if (!strandType(tuple)) {
        errors.push(`D: off-diagonal face (${x},${y})가 허용된 strand pattern이 아닙니다.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function diagonalInterface(grid) {
  return Array.from({ length: grid.n }, (_, index) => ({
    index,
    ...faceTuple(grid, index, index),
  }));
}

export function interfaceEquals(left, right) {
  return JSON.stringify(diagonalInterface(left)) === JSON.stringify(diagonalInterface(right));
}

export function etaPlus(grid) {
  const I = diagonalInterface(grid);
  return I.slice(0, -1).map((tuple, index) => [tuple.N, I[index + 1].W]);
}

export function etaMinus(grid) {
  const I = diagonalInterface(grid);
  return I.slice(0, -1).map((tuple, index) => [tuple.E, I[index + 1].S]);
}

export function seedFromEta(eta) {
  return eta.map(normalizePair);
}

export function complementSeed(seed) {
  return seed.map(complementPair).map(normalizePair);
}

export function nextSeed(row) {
  return row.slice(0, -1).map((entry, index) =>
    normalizePair([entry.v, row[index + 1].l]),
  );
}

function cloneRows(rows) {
  return rows.map((row) => row.map(({ l, v }) => ({ l, v })));
}

function orientationRowsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function alphaBasePair(l, v) {
  if (!ELEMENTS.includes(l) || !ELEMENTS.includes(v) || l === v) {
    throw new Error("한 칸 표에는 서로 다른 두 색이 필요합니다.");
  }
  const h = add(l, v);
  const shift = DEFAULT_ORDER.find((candidate) => omega(h, candidate) === 1);
  if (shift === undefined) throw new Error("한 칸 표의 shift를 찾지 못했습니다.");
  return { l: add(l, shift), v: add(v, shift), shift };
}

export function extractHalf(grid, sign) {
  const rows = [];
  const r = grid.n - 1;
  for (let t = 1; t <= r; t += 1) {
    const row = [];
    for (let i = 0; i <= r - t; i += 1) {
      if (sign === "+") {
        const x = i;
        const y = i + t;
        row.push({ l: grid.v[y][x], v: grid.h[y + 1][x] }); // W, N
      } else {
        const x = i + t;
        const y = i;
        row.push({ l: grid.h[y][x], v: grid.v[y][x + 1] }); // S, E
      }
    }
    rows.push(row);
  }
  return rows;
}

export function writeHalf(grid, sign, rows) {
  const r = grid.n - 1;
  if (rows.length !== r) throw new Error(`${sign} half의 row 수가 잘못되었습니다.`);
  for (let t = 1; t <= r; t += 1) {
    const row = rows[t - 1];
    if (row.length !== r - t + 1) throw new Error(`${sign} half의 row 폭이 잘못되었습니다.`);
    for (let i = 0; i <= r - t; i += 1) {
      const { l, v } = row[i];
      if (sign === "+") {
        const x = i;
        const y = i + t;
        grid.v[y][x] = l; // W
        grid.h[y + 1][x] = v; // N
      } else {
        const x = i + t;
        const y = i;
        grid.h[y][x] = l; // S
        grid.v[y][x + 1] = v; // E
      }
    }
  }
  return grid;
}

export function validateCompletion(seed, rows, kind) {
  let currentSeed = seed.map(normalizePair);
  const errors = [];
  if (rows.length !== currentSeed.length) {
    errors.push(`${kind} completion의 row 수가 seed 폭과 다릅니다.`);
    return { ok: false, errors };
  }
  rows.forEach((row, depth) => {
    if (row.length !== currentSeed.length) {
      errors.push(`depth ${depth}의 row 폭이 잘못되었습니다.`);
      return;
    }
    row.forEach(({ l, v }, index) => {
      const expected = kind === "A" ? currentSeed[index] : complementPair(currentSeed[index]);
      if (l === v || !pairEquals([l, v], expected)) {
        errors.push(`depth ${depth}, index ${index}의 orientation type이 ${kind}와 맞지 않습니다.`);
      }
    });
    for (let index = 0; index < row.length - 1; index += 1) {
      if (row[index].v === row[index + 1].l) {
        errors.push(`depth ${depth}, seam ${index}가 퇴화했습니다.`);
      }
    }
    currentSeed = nextSeed(row);
  });
  return { ok: errors.length === 0, errors };
}

function alpha(seed, rows, trace, context = {}) {
  const r = seed.length;
  if (r === 0) return [];

  const rowOffset = context.rowOffset ?? 0;

  const sourceRows = cloneRows(rows);
  if (r === 1) {
    const [{ l, v }] = rows[0];
    const mapped = alphaBasePair(l, v);
    const result = [[{ l: mapped.l, v: mapped.v }]];
    trace.push({
      type: "alpha-base",
      side: context.side,
      width: 1,
      depth: context.depth ?? 0,
      rowOffset,
      shift: mapped.shift,
      sourceRows,
      targetRows: cloneRows(result),
    });
    return result;
  }

  const o1 = rows[0].map(({ l, v }) => ({ l, v }));
  const Q = nextSeed(o1);
  const transformedTail = alpha(Q, rows.slice(1), trace, {
    ...context,
    depth: (context.depth ?? 0) + 1,
    rowOffset: rowOffset + 1,
  });
  const o2 = transformedTail[0];
  const Y = transformedTail.slice(1);
  const R = nextSeed(o2);

  const diamond = applyDiamond({
    top: o1,
    middle: o2.map(({ l, v }) => ({ c: l, d: v })),
  });
  const o1Prime = diamond.target.top.map(({ l, v }) => ({ l, v }));
  const o2Prime = diamond.target.middle.map(({ c, d }) => ({ l: c, v: d }));
  const QPrime = nextSeed(o1Prime);

  trace.push({
    type: "diamond",
    side: context.side,
    width: r,
    depth: context.depth ?? 0,
    rowOffset,
    shifts: [...diamond.shifts.values],
    sourceTop: o1.map(({ l, v }) => ({ l, v })),
    sourceMiddle: o2.map(({ l, v }) => ({ l, v })),
    targetTop: o1Prime.map(({ l, v }) => ({ l, v })),
    targetMiddle: o2Prime.map(({ l, v }) => ({ l, v })),
  });

  const YPrime = alpha(R, Y, trace, {
    ...context,
    depth: (context.depth ?? 0) + 1,
    rowOffset: rowOffset + 2,
  });
  const ZPrime = [o2Prime, ...YPrime];
  const XPrime = alpha(complementSeed(QPrime), ZPrime, trace, {
    ...context,
    depth: (context.depth ?? 0) + 1,
    rowOffset: rowOffset + 1,
  });
  const result = [o1Prime, ...XPrime];

  trace.push({
    type: "alpha-complete",
    side: context.side,
    width: r,
    depth: context.depth ?? 0,
    rowOffset,
    sourceRows,
    targetRows: cloneRows(result),
  });
  return result;
}

export function beta(seed, rows, trace = [], context = {}) {
  const r = seed.length;
  if (r === 0) return [];
  const rowOffset = context.rowOffset ?? 0;
  const sourceRows = cloneRows(rows);
  const first = rows[0].map(({ l, v }) => ({ l, v }));
  const Q = nextSeed(first);
  const tailA = beta(Q, rows.slice(1), trace, {
    ...context,
    depth: (context.depth ?? 0) + 1,
    rowOffset: rowOffset + 1,
  });
  const gamma = [first, ...tailA];
  const result = alpha(complementSeed(seed), gamma, trace, context);
  trace.push({
    type: "beta-complete",
    side: context.side,
    width: r,
    depth: context.depth ?? 0,
    rowOffset,
    sourceRows,
    targetRows: cloneRows(result),
  });
  return result;
}

export function replayHalfTrace(before, trace) {
  const rows = cloneRows(before);
  const frames = [];

  for (const event of trace) {
    if (event.type !== "alpha-base" && event.type !== "diamond") continue;
    const updates = event.type === "alpha-base"
      ? [{ rowOffset: event.rowOffset, source: event.sourceRows[0], target: event.targetRows[0] }]
      : [
          { rowOffset: event.rowOffset, source: event.sourceTop, target: event.targetTop },
          { rowOffset: event.rowOffset + 1, source: event.sourceMiddle, target: event.targetMiddle },
        ];

    for (const update of updates) {
      if (!rows[update.rowOffset] || !orientationRowsEqual(rows[update.rowOffset], update.source)) {
        throw new Error(`trace row ${update.rowOffset}의 source가 현재 재귀 상태와 맞지 않습니다.`);
      }
      rows[update.rowOffset] = cloneRows([update.target])[0];
    }

    frames.push({
      event,
      updates: updates.map(({ rowOffset, source, target }) => ({
        rowOffset,
        source: cloneRows([source])[0],
        target: cloneRows([target])[0],
      })),
      rows: cloneRows(rows),
    });
  }

  return { rows: cloneRows(rows), frames };
}

function alphaWithoutTrace(seed, rows) {
  return alpha(seed, rows, [], {});
}

export function betaInverse(seed, rows) {
  if (seed.length === 0) return [];
  const temp = alphaWithoutTrace(seed, rows);
  const first = temp[0];
  const Q = nextSeed(first);
  return [first, ...betaInverse(Q, temp.slice(1))];
}

export function transformEtoD(source) {
  const sourceValidation = validateE(source);
  if (!sourceValidation.ok) throw new Error(sourceValidation.errors.join("\n"));

  const plusEta = etaPlus(source);
  const minusEta = etaMinus(source);
  const plusSeed = seedFromEta(plusEta);
  const minusSeed = seedFromEta(minusEta);
  const plusB = extractHalf(source, "+");
  const minusB = extractHalf(source, "-");
  const plusBValidation = validateCompletion(plusSeed, plusB, "B");
  const minusBValidation = validateCompletion(minusSeed, minusB, "B");
  if (!plusBValidation.ok || !minusBValidation.ok) {
    throw new Error([...plusBValidation.errors, ...minusBValidation.errors].join("\n"));
  }

  const plusTrace = [];
  const minusTrace = [];
  const plusA = beta(plusSeed, plusB, plusTrace, { side: "+", depth: 0 });
  const minusA = beta(minusSeed, minusB, minusTrace, { side: "-", depth: 0 });
  const plusAValidation = validateCompletion(plusSeed, plusA, "A");
  const minusAValidation = validateCompletion(minusSeed, minusA, "A");
  if (!plusAValidation.ok || !minusAValidation.ok) {
    throw new Error([...plusAValidation.errors, ...minusAValidation.errors].join("\n"));
  }

  const target = cloneGrid(source);
  writeHalf(target, "+", plusA);
  writeHalf(target, "-", minusA);
  const targetValidation = validateD(target);
  if (!targetValidation.ok) throw new Error(targetValidation.errors.join("\n"));
  if (!interfaceEquals(source, target)) throw new Error("대각 interface가 보존되지 않았습니다.");

  return {
    source: cloneGrid(source),
    target,
    interface: diagonalInterface(source),
    plus: { eta: plusEta, seed: plusSeed, before: plusB, after: plusA, trace: plusTrace },
    minus: { eta: minusEta, seed: minusSeed, before: minusB, after: minusA, trace: minusTrace },
    checks: {
      sourceProper: true,
      targetD: true,
      interfaceFixed: true,
      plusBoundaryOrdered: JSON.stringify(etaPlus(target)) === JSON.stringify(plusEta),
      minusBoundaryOrdered: JSON.stringify(etaMinus(target)) === JSON.stringify(minusEta),
    },
  };
}

export function transformDtoE(source) {
  const sourceValidation = validateD(source);
  if (!sourceValidation.ok) throw new Error(sourceValidation.errors.join("\n"));
  const plusEta = etaPlus(source);
  const minusEta = etaMinus(source);
  const plusSeed = seedFromEta(plusEta);
  const minusSeed = seedFromEta(minusEta);
  const plusA = extractHalf(source, "+");
  const minusA = extractHalf(source, "-");
  const plusB = betaInverse(plusSeed, plusA);
  const minusB = betaInverse(minusSeed, minusA);
  const target = cloneGrid(source);
  writeHalf(target, "+", plusB);
  writeHalf(target, "-", minusB);
  const validation = validateE(target);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (!interfaceEquals(source, target)) throw new Error("역변환에서 대각 interface가 보존되지 않았습니다.");
  return target;
}

function rowCompletions(bottom) {
  const results = [];
  function visit(index, west, top, vertical) {
    if (index === bottom.length) {
      results.push({ top: [...top], vertical: [...vertical] });
      return;
    }
    const south = bottom[index];
    if (west === south) return;
    const remaining = ELEMENTS.filter((value) => value !== west && value !== south);
    visit(index + 1, remaining[1], [...top, remaining[0]], [...vertical, remaining[1]]);
    visit(index + 1, remaining[0], [...top, remaining[1]], [...vertical, remaining[0]]);
  }
  for (const west of ELEMENTS) visit(0, west, [], [west]);
  return results;
}

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

export function randomEGrid(n = 3, rng = Math.random) {
  if (!Number.isInteger(n) || n < 1 || n > 7) throw new Error("n은 1 이상 7 이하의 정수여야 합니다.");
  const grid = createGrid(n);
  grid.h[0] = Array.from({ length: n }, () => randomItem(ELEMENTS, rng));
  for (let y = 0; y < n; y += 1) {
    const options = rowCompletions(grid.h[y]);
    if (!options.length) throw new Error(`row ${y}를 proper하게 완성할 수 없습니다.`);
    const chosen = randomItem(options, rng);
    grid.h[y + 1] = chosen.top;
    grid.v[y] = chosen.vertical;
  }
  const validation = validateE(grid);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  return grid;
}

export function encodeGrid(grid) {
  return encodeURIComponent(btoa(JSON.stringify(grid)));
}

export function decodeGrid(value) {
  const grid = JSON.parse(atob(decodeURIComponent(value)));
  const validation = validateE(grid);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  return grid;
}

export function decodeDraftGrid(value) {
  const grid = JSON.parse(atob(decodeURIComponent(value)));
  const errors = validateShape(grid, { allowNull: true });
  if (errors.length) throw new Error(errors.join("\n"));
  return grid;
}
