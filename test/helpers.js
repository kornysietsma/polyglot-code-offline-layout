const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LAYOUT = path.join(__dirname, '..', 'layout.js');
const POINTS = 128; // layout.js default

// Area of the regular n-gon that computeCirclingPolygon() inscribes in a circle
// of radius r, as a multiple of r^2. Slightly under pi (0.99987 * pi at n=128).
const polygonAreaFactor = (points = POINTS) =>
  0.5 * points * Math.sin((2 * Math.PI) / points);

// Every circle in the layout has radius sqrt(loc), so a node sized to its own
// loc has polygon area EXPECTED_AREA_PER_LOC * loc. This is the constant the
// whole "area is proportional to lines of code" property rests on.
const EXPECTED_AREA_PER_LOC = polygonAreaFactor(POINTS);

function runLayout(inputTree, flags = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polyglot-layout-test-'));
  const inFile = path.join(tmp, 'in.json');
  const outFile = path.join(tmp, 'out.json');
  try {
    fs.writeFileSync(inFile, JSON.stringify(inputTree));
    execFileSync(process.execPath, [LAYOUT, ...flags, '-i', inFile, '-o', outFile], {
      stdio: ['ignore', 'ignore', 'pipe'], // layout.js logs progress to stderr
    });
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function polygonArea(polygon) {
  let doubled = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    doubled += x1 * y2 - x2 * y1;
  }
  return Math.abs(doubled) / 2;
}

const isGitRepoRoot = (node) =>
  Boolean(node.data && node.data.git && (node.data.git.remote_url || node.data.git.head));

function findByPath(tree, wanted) {
  let found = null;
  walk(tree, (node) => {
    if ((node.path || '') === wanted) found = node;
  });
  if (!found) throw new Error(`no node at path '${wanted}'`);
  return found;
}

// Visit every node, passing (node, { depth, insideRepo }). insideRepo is false
// *at* a repo root and true for everything below it.
function walk(node, fn, depth = 0, insideRepo = false) {
  fn(node, { depth, insideRepo });
  const childrenInsideRepo = insideRepo || isGitRepoRoot(node);
  for (const child of node.children || []) {
    walk(child, fn, depth + 1, childrenInsideRepo);
  }
}

function repoRoots(tree) {
  const found = [];
  walk(tree, (node, { insideRepo }) => {
    if (!insideRepo && isGitRepoRoot(node)) found.push(node);
  });
  return found;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

module.exports = {
  EXPECTED_AREA_PER_LOC,
  POINTS,
  distance,
  findByPath,
  isGitRepoRoot,
  polygonArea,
  polygonAreaFactor,
  repoRoots,
  runLayout,
  walk,
};
