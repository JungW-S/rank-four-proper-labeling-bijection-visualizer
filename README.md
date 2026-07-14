# Rank-four proper-labeling bijection visualizer

An interactive, dependency-free visualization of the global bijection

```text
E_n  <->  D_n.
```

- `E_n`: edge labelings of an `n x n` square grid by `1,2,3,4` in which every face is proper.
- `D_n`: diagonal faces remain proper, while every off-diagonal face is one of the two allowed strand patterns.

The construction fixes every physical edge of the diagonal interface pointwise and applies the recursive half-region maps independently in the northwest and southeast regions.

The project is a static site and is compatible with GitHub Pages. After Pages is enabled, its expected URL is:

<https://jungw-s.github.io/rank-four-proper-labeling-bijection-visualizer/>

## Features

- Enter edge values directly, start from a blank grid, or generate a random valid `E_n`.
- Detect missing edges and duplicate labels before the bijection is run.
- Replay the actual construction order: input, diagonal copy, northwest recursion, southeast recursion, completion.
- Inspect each `beta_r` checkpoint with `old -> new` edge labels.
- Distinguish newly revealed edges from readjusted existing strands.
- Open the exact `alpha-base` and diamond `Phi` calls responsible for a changed edge.
- Preserve the full example and current frame in a shareable URL hash.

## Run locally

```bash
./serve.sh
```

Then open <http://127.0.0.1:4173/>.

No build step or server-side computation is required. All calculations run in the browser.

## Tests

```bash
npm test
```

The test suite includes 1,500 random full-grid round trips, 1,800 local-engine random cases, and exhaustive checks in the smallest nontrivial sizes.

For an optional real-browser interaction smoke test, start Chrome with a remote-debugging port and run:

```bash
node tests/browser-smoke.mjs 9225
```

## Project structure

- `index.html`, `style.css`: static interface and visual design.
- `src/app.mjs`: SVG rendering and interaction flow.
- `src/grid-bijection.mjs`: full-grid bijection and explicit inverse.
- `src/bijection.mjs`: local two-row diamond operation.
- `tests/`: algorithm and browser interaction checks.
