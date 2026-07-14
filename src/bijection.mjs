export const ELEMENTS = Object.freeze([0, 1, 2, 3]);
export const DEFAULT_ORDER = Object.freeze([0, 1, 2, 3]);

export const LABEL_TEXT = Object.freeze({
  0: "00",
  1: "01",
  2: "10",
  3: "11",
});

export function add(x, y) {
  return x ^ y;
}

export function omega(x, y) {
  const x1 = x & 1;
  const x2 = (x >> 1) & 1;
  const y1 = y & 1;
  const y2 = (y >> 1) & 1;
  return (x1 * y2 + x2 * y1) & 1;
}

export function formatLabel(value) {
  return LABEL_TEXT[value] ?? "??";
}

export function normalizePair(pair) {
  return [...pair].sort((a, b) => a - b);
}

export function pairEquals(left, right) {
  const a = normalizePair(left);
  const b = normalizePair(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function complementPair(pair) {
  const members = new Set(pair);
  return ELEMENTS.filter((value) => !members.has(value));
}

export function isComplementPair(source, target) {
  return pairEquals(complementPair(source), target);
}

export function cloneConfig(config) {
  return {
    top: config.top.map(({ l, v }) => ({ l, v })),
    middle: config.middle.map(({ c, d }) => ({ c, d })),
  };
}

export function configsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateConfig(config) {
  const errors = [];

  if (!config || !Array.isArray(config.top) || !Array.isArray(config.middle)) {
    return { ok: false, errors: ["구성 데이터가 없습니다."] };
  }

  if (config.middle.length < 1 || config.top.length !== config.middle.length + 1) {
    errors.push("top 길이는 middle 길이보다 정확히 1 커야 합니다.");
  }

  const validValue = (value) => Number.isInteger(value) && ELEMENTS.includes(value);

  config.top.forEach(({ l, v }, index) => {
    if (!validValue(l) || !validValue(v)) {
      errors.push(`P_${index}에 V 바깥의 라벨이 있습니다.`);
    } else if (l === v) {
      errors.push(`P_${index}의 두 라벨이 같습니다.`);
    }
  });

  config.middle.forEach(({ c, d }, index) => {
    if (!validValue(c) || !validValue(d)) {
      errors.push(`Q_${index}^c에 V 바깥의 라벨이 있습니다.`);
      return;
    }

    if (c === d) {
      errors.push(`Q_${index}^c의 두 라벨이 같습니다.`);
    }

    if (!config.top[index] || !config.top[index + 1]) {
      return;
    }

    const a = config.top[index].v;
    const b = config.top[index + 1].l;

    if (a === b) {
      errors.push(`Q_${index}={v_${index},l_${index + 1}}가 2원소 집합이 아닙니다.`);
    } else if (!isComplementPair([a, b], [c, d])) {
      errors.push(`(c_${index},d_${index})가 Q_${index}의 보완쌍을 향화한 것이 아닙니다.`);
    }

    if (add(a, c) !== add(b, d)) {
      errors.push(`slice ${index}에서 두 방식으로 계산한 k_${index}가 다릅니다.`);
    }
  });

  for (let index = 0; index < config.middle.length - 1; index += 1) {
    if (config.middle[index].d === config.middle[index + 1].c) {
      errors.push(`R_${index}={d_${index},c_${index + 1}}가 2원소 집합이 아닙니다.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function computeDirections(config) {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  const H = config.top.map(({ l, v }) => add(l, v));
  const k = config.middle.map(({ c }, index) => add(config.top[index].v, c));
  const J = config.middle
    .slice(0, -1)
    .map(({ d }, index) => add(d, config.middle[index + 1].c));

  return { H, k, J };
}

export function computeCanonicalShifts(config, order = DEFAULT_ORDER) {
  const { H, k } = computeDirections(config);
  const details = H.map((direction, index) => {
    const constraints = [{ family: "H", index, value: direction }];

    if (index >= 1) {
      constraints.push({ family: "k", index: index - 1, value: k[index - 1] });
    }

    if (index < k.length) {
      constraints.push({ family: "k", index, value: k[index] });
    }

    const solutions = order.filter((candidate) =>
      constraints.every(({ value }) => omega(value, candidate) === 1),
    );

    if (solutions.length === 0) {
      throw new Error(`s_${index}의 제약식을 만족하는 벡터가 없습니다.`);
    }

    return {
      index,
      constraints,
      solutions,
      chosen: solutions[0],
    };
  });

  return {
    values: details.map(({ chosen }) => chosen),
    details,
  };
}

export function applyDiamond(config, order = DEFAULT_ORDER) {
  const source = cloneConfig(config);
  const shifts = computeCanonicalShifts(source, order);

  const target = {
    top: source.top.map(({ l, v }, index) => ({
      l: add(l, shifts.values[index]),
      v: add(v, shifts.values[index]),
    })),
    middle: source.middle.map(({ c, d }, index) => ({
      c: add(c, shifts.values[index]),
      d: add(d, shifts.values[index + 1]),
    })),
  };

  const targetValidation = validateConfig(target);
  if (!targetValidation.ok) {
    throw new Error(`변환된 구성이 유효하지 않습니다:\n${targetValidation.errors.join("\n")}`);
  }

  return { source, target, shifts };
}

export function getBoundaries(config) {
  return {
    P: config.top.map(({ l, v }) => normalizePair([l, v])),
    Q: config.middle.map((_, index) =>
      normalizePair([config.top[index].v, config.top[index + 1].l]),
    ),
    Qc: config.middle.map(({ c, d }) => normalizePair([c, d])),
    R: config.middle
      .slice(0, -1)
      .map(({ d }, index) => normalizePair([d, config.middle[index + 1].c])),
  };
}

export function getSlices(config) {
  return config.middle.map(({ c, d }, index) => ({
    a: config.top[index].v,
    b: config.top[index + 1].l,
    c,
    d,
  }));
}

export function verifyDiamond(config, order = DEFAULT_ORDER) {
  const { source, target, shifts } = applyDiamond(config, order);
  const second = applyDiamond(target, order);
  const sourceBoundary = getBoundaries(source);
  const targetBoundary = getBoundaries(target);
  const sourceDirections = computeDirections(source);
  const targetDirections = computeDirections(target);

  const checks = [
    {
      key: "source-valid",
      label: "입력은 양의 구성",
      ok: validateConfig(source).ok,
    },
    {
      key: "direction-identity",
      label: "Jⱼ=Hⱼ₊₁⊕kⱼ⊕kⱼ₊₁",
      ok: sourceDirections.J.every(
        (value, index) =>
          value ===
          add(sourceDirections.H[index + 1], add(sourceDirections.k[index], sourceDirections.k[index + 1])),
      ),
    },
    {
      key: "slice-valid",
      label: "변환 뒤 모든 slice가 V의 순열",
      ok: getSlices(target).every(
        ({ a, b, c, d }) => new Set([a, b, c, d]).size === ELEMENTS.length,
      ),
    },
    {
      key: "top-complement",
      label: "위 경계 P가 Pᶜ로 변환",
      ok: sourceBoundary.P.every((pair, index) =>
        isComplementPair(pair, targetBoundary.P[index]),
      ),
    },
    {
      key: "lower-complement",
      label: sourceBoundary.R.length ? "아래 경계 R이 Rᶜ로 변환" : "m=0: 아래 경계 검사는 공허",
      ok: sourceBoundary.R.every((pair, index) =>
        isComplementPair(pair, targetBoundary.R[index]),
      ),
    },
    {
      key: "directions",
      label: "H와 k 방향 보존",
      ok:
        JSON.stringify(sourceDirections.H) === JSON.stringify(targetDirections.H) &&
        JSON.stringify(sourceDirections.k) === JSON.stringify(targetDirections.k),
    },
    {
      key: "same-shifts",
      label: "역방향에서도 같은 canonical shifts",
      ok:
        JSON.stringify(shifts.values) === JSON.stringify(second.shifts.values),
    },
    {
      key: "involution",
      label: "두 번 적용하면 원래 oriented labels로 복귀",
      ok: configsEqual(source, second.target),
    },
  ];

  return {
    source,
    target,
    shifts,
    sourceBoundary,
    targetBoundary,
    sourceDirections,
    targetDirections,
    secondTarget: second.target,
    checks,
    ok: checks.every(({ ok }) => ok),
  };
}

function randomElement(array, rng) {
  return array[Math.floor(rng() * array.length)];
}

function randomOrientedPair(rng) {
  const l = randomElement(ELEMENTS, rng);
  const v = randomElement(
    ELEMENTS.filter((value) => value !== l),
    rng,
  );
  return { l, v };
}

export function randomValidConfig(m = 1, rng = Math.random) {
  if (!Number.isInteger(m) || m < 0 || m > 8) {
    throw new Error("m은 0 이상 8 이하의 정수여야 합니다.");
  }

  const top = [randomOrientedPair(rng)];
  for (let index = 1; index < m + 2; index += 1) {
    const previousV = top[index - 1].v;
    const l = randomElement(
      ELEMENTS.filter((value) => value !== previousV),
      rng,
    );
    const v = randomElement(
      ELEMENTS.filter((value) => value !== l),
      rng,
    );
    top.push({ l, v });
  }

  const middle = [];
  for (let index = 0; index < m + 1; index += 1) {
    const complement = complementPair([top[index].v, top[index + 1].l]);
    let orientations = [
      { c: complement[0], d: complement[1] },
      { c: complement[1], d: complement[0] },
    ];

    if (index > 0) {
      orientations = orientations.filter(({ c }) => c !== middle[index - 1].d);
    }

    middle.push(randomElement(orientations, rng));
  }

  const candidate = { top, middle };
  const validation = validateConfig(candidate);
  if (!validation.ok) {
    throw new Error(`랜덤 생성기의 내부 오류:\n${validation.errors.join("\n")}`);
  }
  return candidate;
}

export function defaultExample() {
  return {
    top: [
      { l: 0, v: 1 },
      { l: 0, v: 2 },
      { l: 0, v: 1 },
    ],
    middle: [
      { c: 3, d: 2 },
      { c: 1, d: 3 },
    ],
  };
}

export function encodeConfig(config) {
  return encodeURIComponent(btoa(JSON.stringify(config)));
}

export function decodeConfig(serialized) {
  const config = JSON.parse(atob(decodeURIComponent(serialized)));
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }
  return config;
}
