#!/usr/bin/env node
// Invariant tests for layout.js.
//
// These are deliberately not exhaustive. They pin down the handful of
// properties that are easy to break silently and hard to spot by eye - above
// all: a repository's drawn area is proportional to its lines of code, at the
// same ratio no matter how deeply it is nested.
//
// Run with: npm test

const assert = require('assert');
const {
  EXPECTED_AREA_PER_LOC,
  distance,
  findByPath,
  isGitRepoRoot,
  polygonArea,
  repoRoots,
  runLayout,
  walk,
} = require('./helpers');
const fixtures = require('./fixtures');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Relative comparison - circle polygons are exact, voronoi cells only converge
// to within a few percent, so callers pick an appropriate epsilon.
function assertClose(actual, expected, epsilon, message) {
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    rel <= epsilon,
    `${message}: expected ${expected}, got ${actual} (off by ${(rel * 100).toFixed(4)}%, allowed ${(epsilon * 100).toFixed(4)}%)`
  );
}

const areaPerLoc = (node) => polygonArea(node.layout.polygon) / node.value;

// ---------------------------------------------------------------------------

test('nested mode: repo area is proportional to loc at every depth', () => {
  const { tree } = runLayout(fixtures.sameRepoAtEveryDepth(), ['-n']);
  const repos = repoRoots(tree);
  assert.strictEqual(repos.length, 8, 'expected all 8 repos to survive pruning');

  for (const repo of repos) {
    assertClose(
      areaPerLoc(repo),
      EXPECTED_AREA_PER_LOC,
      1e-9,
      `repo '${repo.path}' area:loc ratio`
    );
  }

  // The same repo contents placed at depths 1..5 must come out identical.
  const byDepth = [1, 2, 3, 4, 5].map((d) =>
    repos.find((r) => r.name === `r_depth${d}`)
  );
  assert.ok(byDepth.every(Boolean), 'expected r_depth1..r_depth5');
  for (const repo of byDepth) {
    assertClose(
      repo.layout.radius,
      byDepth[0].layout.radius,
      1e-12,
      `'${repo.path}' radius vs the depth-1 repo`
    );
  }
});

test('nested mode agrees with circles mode when every repo is top level', () => {
  const nested = runLayout(fixtures.flatRepos(), ['-n']).tree;
  const circles = runLayout(fixtures.flatRepos(), ['-c']).tree;

  for (const repo of repoRoots(nested)) {
    const other = findByPath(circles, repo.path);
    assertClose(
      repo.layout.radius,
      other.layout.radius,
      1e-12,
      `'${repo.path}' radius differs between -n and -c`
    );
  }
});

test('nested mode: repos are never scaled, directories grow to contain them', () => {
  const { tree } = runLayout(fixtures.sameRepoAtEveryDepth(), ['-n']);
  let grown = 0;

  walk(tree, (node, { insideRepo }) => {
    if (insideRepo || !node.layout) return;
    if (isGitRepoRoot(node)) {
      assert.strictEqual(
        node.layout.scaleFactor,
        1.0,
        `repo '${node.path}' must keep its natural size (scaleFactor 1.0)`
      );
    } else if (node.children) {
      assert.ok(
        node.layout.scaleFactor >= 1.0,
        `directory '${node.path}' shrank (scaleFactor ${node.layout.scaleFactor})`
      );
      if (node.layout.scaleFactor > 1.0) grown += 1;
    }
  });

  assert.ok(grown > 0, 'expected at least one directory to grow to fit its children');
});

test('nested mode: packed children stay inside their parent and do not overlap', () => {
  const { tree } = runLayout(fixtures.sameRepoAtEveryDepth(), ['-n']);
  let checked = 0;

  walk(tree, (node, { insideRepo }) => {
    // Only nodes outside a repo have circle-packed children; inside a repo the
    // children are voronoi cells and `radius` does not bound their polygon.
    if (insideRepo || isGitRepoRoot(node) || !node.children || !node.layout) return;
    const kids = node.children.filter((c) => c.layout);

    for (const child of kids) {
      const reach = distance(node.layout.center, child.layout.center) + child.layout.radius;
      assert.ok(
        reach <= node.layout.radius * (1 + 1e-9),
        `'${child.path}' escapes '${node.path || '<root>'}': reaches ${reach}, parent radius ${node.layout.radius}`
      );
      checked += 1;
    }

    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const gap = distance(kids[i].layout.center, kids[j].layout.center);
        assert.ok(
          gap >= (kids[i].layout.radius + kids[j].layout.radius) * (1 - 1e-9),
          `'${kids[i].path}' overlaps '${kids[j].path}'`
        );
      }
    }
  });

  assert.ok(checked > 0, 'expected to check some circle-packed children');
});

test('a tree that is itself a repo uses the same area:loc scale', () => {
  const { tree } = runLayout(fixtures.treeRootIsRepo(), ['-n']);

  // Regression: this used to be pinned to a fixed radius of 512, giving a wildly
  // different area:loc ratio from a repo nested inside directories, and a
  // `radius` field that disagreed with the polygon it was meant to describe.
  assertClose(areaPerLoc(tree), EXPECTED_AREA_PER_LOC, 1e-9, 'root repo area:loc ratio');
  assertClose(
    tree.layout.radius,
    Math.sqrt(tree.value),
    1e-12,
    'root repo radius should be sqrt(loc)'
  );
});

test('a repo vendored inside a repo keeps the same area:loc ratio', () => {
  const { tree } = runLayout(fixtures.repoInsideRepo(), ['-n']);
  const outer = findByPath(tree, 'outer');
  const vendored = findByPath(tree, 'outer/vendored');
  const control = findByPath(tree, 'plain/control');

  // The outer repo is a circle, so exact; the inner one is a voronoi cell and
  // only converges to within a few percent.
  assertClose(areaPerLoc(outer), EXPECTED_AREA_PER_LOC, 1e-9, 'outer repo area:loc');
  assertClose(areaPerLoc(control), EXPECTED_AREA_PER_LOC, 1e-9, 'control repo area:loc');
  assertClose(areaPerLoc(vendored), EXPECTED_AREA_PER_LOC, 0.05, 'vendored repo area:loc');
});

test('voronoi cells partition their parent, so loc proportions survive nesting', () => {
  const { tree } = runLayout(fixtures.repoInsideRepo(), ['-n']);

  walk(tree, (node, { insideRepo }) => {
    if (!(insideRepo || isGitRepoRoot(node)) || !node.children || !node.layout) return;
    const total = node.children.reduce((sum, c) => sum + polygonArea(c.layout.polygon), 0);
    assertClose(
      total,
      polygonArea(node.layout.polygon),
      1e-6,
      `children of '${node.path}' do not tile it`
    );
  });
});

test('circle-packed nodes keep width/height after voronoi lays out their contents', () => {
  // Regression: calculateVoronoi replaces node.layout wholesale, which used to
  // drop width/height from every repo root in nested mode.
  for (const [label, flags, fixture] of [
    ['nested', ['-n'], fixtures.sameRepoAtEveryDepth()],
    ['circles', ['-c'], fixtures.flatRepos()],
  ]) {
    const { tree } = runLayout(fixture, flags);
    for (const repo of repoRoots(tree)) {
      const { width, height, radius } = repo.layout;
      assert.strictEqual(width, radius * 2, `${label}: '${repo.path}' width`);
      assert.strictEqual(height, radius * 2, `${label}: '${repo.path}' height`);
    }
    assert.ok(tree.layout.width > 0, `${label}: root width`);
  }
});

test('files are emitted with no children key', () => {
  // The streaming JSON writer must not turn `children: undefined` into null -
  // consumers use the absence of the key to tell a file from a directory.
  const { tree } = runLayout(fixtures.repoInsideRepo(), ['-n']);
  let files = 0;

  walk(tree, (node) => {
    if (node.children) return;
    assert.ok(!('children' in node), `file '${node.path}' has a children key`);
    files += 1;
  });

  assert.ok(files > 0, 'expected some files');
});

// ---------------------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n       ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed > 0 ? 1 : 0);
