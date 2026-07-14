import assert from "node:assert/strict";
import {
  ELEMENTS,
  applyDiamond,
  complementPair,
  computeCanonicalShifts,
  computeDirections,
  configsEqual,
  defaultExample,
  pairEquals,
  randomValidConfig,
  validateConfig,
  verifyDiamond,
} from "../src/bijection.mjs";

const example = defaultExample();
assert.deepEqual(computeDirections(example), {
  H: [1, 2, 1],
  k: [2, 3],
  J: [3],
});
assert.deepEqual(computeCanonicalShifts(example).values, [3, 1, 2]);

const first = applyDiamond(example);
const second = applyDiamond(first.target);
assert(configsEqual(example, second.target));
assert(verifyDiamond(example).ok);

for (let m = 0; m <= 5; m += 1) {
  for (let sample = 0; sample < 300; sample += 1) {
    const config = randomValidConfig(m);
    const result = verifyDiamond(config);
    assert(validateConfig(config).ok);
    assert(result.ok, `random verification failed for m=${m}`);
  }
}

const orderedPairs = [];
for (const left of ELEMENTS) {
  for (const right of ELEMENTS) {
    if (left !== right) orderedPairs.push([left, right]);
  }
}

function* products(items, length, prefix = []) {
  if (length === 0) {
    yield prefix;
    return;
  }
  for (const item of items) {
    yield* products(items, length - 1, [...prefix, item]);
  }
}

function countAndVerify(m) {
  let count = 0;
  for (const topWord of products(orderedPairs, m + 2)) {
    const top = topWord.map(([l, v]) => ({ l, v }));
    if (top.slice(0, -1).some(({ v }, index) => v === top[index + 1].l)) continue;

    const middleOptions = top.slice(0, -1).map(({ v }, index) => {
      const [x, y] = complementPair([v, top[index + 1].l]);
      return [
        { c: x, d: y },
        { c: y, d: x },
      ];
    });

    for (const middle of productsByPosition(middleOptions)) {
      const config = { top, middle };
      if (!validateConfig(config).ok) continue;
      const result = verifyDiamond(config);
      assert(result.ok, `exhaustive verification failed for m=${m}`);
      result.sourceBoundary.P.forEach((pair, index) => {
        assert(pairEquals(complementPair(pair), result.targetBoundary.P[index]));
      });
      count += 1;
    }
  }
  return count;
}

function* productsByPosition(options, index = 0, prefix = []) {
  if (index === options.length) {
    yield prefix;
    return;
  }
  for (const item of options[index]) {
    yield* productsByPosition(options, index + 1, [...prefix, item]);
  }
}

assert.equal(countAndVerify(0), 216);
assert.equal(countAndVerify(1), 3024);
assert.equal(countAndVerify(2), 42336);

console.log("bijection tests passed: golden example, 1,800 random cases, m≤2 exhaustive");
