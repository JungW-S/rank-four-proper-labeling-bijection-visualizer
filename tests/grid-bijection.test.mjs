import assert from "node:assert/strict";
import {
  alphaBasePair,
  cloneGrid,
  createGrid,
  decodeDraftGrid,
  decodeGrid,
  diagonalInterface,
  encodeGrid,
  faceTuple,
  gridsEqual,
  interfaceEquals,
  randomEGrid,
  replayHalfTrace,
  strandType,
  transformDtoE,
  transformEtoD,
  validateD,
  validateE,
  validatePartialE,
  writeHalf,
} from "../src/grid-bijection.mjs";

const V = [0, 1, 2, 3];

{
  const rules = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
    [[1, 2], [0, 3]],
    [[1, 3], [0, 2]],
    [[2, 3], [0, 1]],
  ];
  for (const [[l, v], [expectedL, expectedV]] of rules) {
    const mapped = alphaBasePair(l, v);
    assert.deepEqual([mapped.l, mapped.v], [expectedL, expectedV]);
    const reversed = alphaBasePair(v, l);
    assert.deepEqual([reversed.l, reversed.v], [expectedV, expectedL]);
    const recovered = alphaBasePair(mapped.l, mapped.v);
    assert.deepEqual([recovered.l, recovered.v], [l, v]);
  }
  assert.throws(() => alphaBasePair(0, 0));
}

{
  const blank = createGrid(3);
  const blankValidation = validatePartialE(blank);
  assert.equal(blankValidation.ok, false);
  assert.equal(blankValidation.complete, false);
  assert.equal(blankValidation.assignedEdges, 0);
  assert.equal(blankValidation.totalEdges, 24);
  assert.equal(blankValidation.invalidFaces.length, 0);
  assert.equal(blankValidation.incompleteFaces.length, 9);
  assert.deepEqual(decodeDraftGrid(encodeGrid(blank)), blank);
  assert.throws(() => decodeGrid(encodeGrid(blank)));

  const conflicting = createGrid(1);
  conflicting.h[0][0] = 2;
  conflicting.v[0][0] = 2;
  const conflictValidation = validatePartialE(conflicting);
  assert.equal(conflictValidation.ok, false);
  assert.equal(conflictValidation.invalidFaces.length, 1);
  assert.deepEqual(conflictValidation.invalidFaces[0].duplicates, [{ value: 2, sides: ["W", "S"] }]);
  assert.deepEqual(decodeDraftGrid(encodeGrid(conflicting)), conflicting);

  const valid = randomEGrid(3);
  const validValidation = validatePartialE(valid);
  assert.equal(validValidation.ok, true);
  assert.equal(validValidation.complete, true);
  assert.equal(validValidation.properFaces, 9);
}

{
  const singleton = transformEtoD(randomEGrid(1, () => 0));
  assert.equal(singleton.plus.trace.length, 0);
  assert.equal(singleton.minus.trace.length, 0);

  const fixture = randomEGrid(3, () => 0);
  const inputCorner = faceTuple(fixture, 0, 2);
  assert.deepEqual([inputCorner.W, inputCorner.N], [0, 2]);
  const firstMapped = alphaBasePair(inputCorner.W, inputCorner.N);
  assert.deepEqual([firstMapped.l, firstMapped.v], [1, 3]);
  const fixtureResult = transformEtoD(fixture);
  const firstCheckpoint = fixtureResult.plus.trace.find(({ type, width }) => type === "beta-complete" && width === 1);
  assert.deepEqual(firstCheckpoint.targetRows[0][0], { l: firstMapped.l, v: firstMapped.v });
  const finalCorner = faceTuple(fixtureResult.target, 0, 2);
  assert.notDeepEqual([finalCorner.W, finalCorner.N], [firstMapped.l, firstMapped.v]);
}

for (let n = 1; n <= 6; n += 1) {
  for (let sample = 0; sample < 250; sample += 1) {
    const E = randomEGrid(n);
    assert(validateE(E).ok, `random E invalid at n=${n}`);
    const result = transformEtoD(E);
    assert(validateD(result.target).ok, `image D invalid at n=${n}`);
    assert(interfaceEquals(E, result.target), `interface changed at n=${n}`);
    assert.deepEqual(diagonalInterface(E), diagonalInterface(result.target));
    if (n >= 2) {
      const corner = faceTuple(E, 0, n - 1);
      const mapped = alphaBasePair(corner.W, corner.N);
      const firstCheckpoint = result.plus.trace.find(({ type, width }) => type === "beta-complete" && width === 1);
      assert.deepEqual(firstCheckpoint.targetRows[0][0], { l: mapped.l, v: mapped.v });
    }
    const recovered = transformDtoE(result.target);
    assert(gridsEqual(E, recovered), `round trip failed at n=${n}`);
    assertTraceCheckpoints(E, result, "+");
    assertTraceCheckpoints(E, result, "-");
  }
}

function assertTraceCheckpoints(source, result, sign) {
  const part = sign === "+" ? result.plus : result.minus;
  const primitiveReplay = replayHalfTrace(part.before, part.trace);
  assert.deepEqual(primitiveReplay.rows, part.after, `${sign} primitive trace replay mismatch`);

  const rows = part.before.map((row) => row.map(({ l, v }) => ({ l, v })));
  const work = cloneGrid(source);
  const events = part.trace.filter(({ type }) => type === "beta-complete");
  events.forEach((event, index) => {
    assert.equal(event.width, index + 1);
    assert.equal(event.rowOffset, source.n - 1 - event.width);
    event.targetRows.forEach((row, rowIndex) => {
      rows[event.rowOffset + rowIndex] = row.map(({ l, v }) => ({ l, v }));
    });
    writeHalf(work, sign, rows);
    assert(interfaceEquals(source, work), `${sign} checkpoint changed interface`);
    for (let y = 0; y < source.n; y += 1) {
      for (let x = 0; x < source.n; x += 1) {
        const inHalf = sign === "+" ? y > x : x > y;
        const completed = inHalf && Math.abs(y - x) - 1 >= event.rowOffset;
        if (completed) assert(strandType(faceTuple(work, x, y)), `${sign} checkpoint face is not strand`);
      }
    }
  });
  assert.deepEqual(rows, part.after, `${sign} beta-complete checkpoint replay mismatch`);
}

function rowOptions(bottom) {
  const results = [];
  function visit(index, west, top, vertical) {
    if (index === bottom.length) {
      results.push({ top, vertical });
      return;
    }
    const south = bottom[index];
    if (west === south) return;
    const [a, b] = V.filter((value) => value !== west && value !== south);
    visit(index + 1, b, [...top, a], [...vertical, b]);
    visit(index + 1, a, [...top, b], [...vertical, a]);
  }
  for (const west of V) visit(0, west, [], [west]);
  return results;
}

function dRowOptions(bottom, y) {
  const results = [];
  function visit(index, west, top, vertical) {
    if (index === bottom.length) {
      results.push({ top, vertical });
      return;
    }
    const south = bottom[index];
    if (index === y) {
      if (west === south) return;
      const [a, b] = V.filter((value) => value !== west && value !== south);
      visit(index + 1, b, [...top, a], [...vertical, b]);
      visit(index + 1, a, [...top, b], [...vertical, a]);
      return;
    }
    if (west === south) {
      for (const other of V.filter((value) => value !== west)) {
        visit(index + 1, other, [...top, other], [...vertical, other]);
      }
    } else {
      visit(index + 1, west, [...top, south], [...vertical, west]);
    }
  }
  for (const west of V) visit(0, west, [], [west]);
  return results;
}

function words(length, prefix = []) {
  if (length === 0) return [prefix];
  return V.flatMap((value) => words(length - 1, [...prefix, value]));
}

function enumerateE(n) {
  const grids = [];
  function grow(grid, y) {
    if (y === n) {
      grids.push(cloneGrid(grid));
      return;
    }
    for (const option of rowOptions(grid.h[y])) {
      grid.h[y + 1] = option.top;
      grid.v[y] = option.vertical;
      grow(grid, y + 1);
    }
  }
  for (const bottom of words(n)) {
    const grid = createGrid(n);
    grid.h[0] = bottom;
    grow(grid, 0);
  }
  return grids;
}

function enumerateD(n) {
  const grids = [];
  function grow(grid, y) {
    if (y === n) {
      grids.push(cloneGrid(grid));
      return;
    }
    for (const option of dRowOptions(grid.h[y], y)) {
      grid.h[y + 1] = option.top;
      grid.v[y] = option.vertical;
      grow(grid, y + 1);
    }
  }
  for (const bottom of words(n)) {
    const grid = createGrid(n);
    grid.h[0] = bottom;
    grow(grid, 0);
  }
  return grids;
}

const expectedCounts = [24, 1344];
for (let n = 1; n <= 2; n += 1) {
  const allE = enumerateE(n);
  assert.equal(allE.length, expectedCounts[n - 1]);
  const imageKeys = new Set();
  for (const E of allE) {
    const D = transformEtoD(E).target;
    assert(validateD(D).ok);
    imageKeys.add(JSON.stringify(D));
  }
  assert.equal(imageKeys.size, expectedCounts[n - 1], `E→D collision at n=${n}`);
  const allDKeys = new Set(enumerateD(n).map((grid) => JSON.stringify(grid)));
  assert.equal(allDKeys.size, expectedCounts[n - 1]);
  assert.deepEqual(imageKeys, allDKeys, `E→D image does not cover D_n at n=${n}`);
}

console.log("full-grid tests passed: 1,500 random round trips and exhaustive n≤2 bijection");
