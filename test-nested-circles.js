#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Load test data
const testFile = process.argv[2] || 'manual_test/out/manual-test-output.json';
const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    passCount++;
  } else {
    console.error(`✗ ${message}`);
    failCount++;
  }
}

function distance(p1, p2) {
  return Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2);
}

function isGitRoot(node) {
  return node.data?.git && (node.data.git.remote_url || node.data.git.head);
}

function findNode(tree, path) {
  if (path === '' || path === '<root>') return tree;
  const parts = path.split('/');
  let current = tree;
  for (const part of parts) {
    if (!current.children) return null;
    current = current.children.find(c => c.name === part);
    if (!current) return null;
  }
  return current;
}

console.log('=== Testing Nested Circle Packing Layout ===\n');

// Test 1: Git roots should have scaleFactor = 1.0 (area proportional to value)
console.log('Test 1: Git repository roots have consistent scaling (scaleFactor = 1.0)');
const gitRoots = [
  'a/a1/beauty/beauty-service',
  'a/a2/sofa-ui',
  'b/b1',
  'b/chat/chat-service',
  'b/chat/chat-snap-in',
  'b/chat/pii-removal',
  'b/chat/video-chat-widget'
];

gitRoots.forEach(path => {
  const node = findNode(data.tree, path);
  if (node && node.layout) {
    assert(
      Math.abs(node.layout.scaleFactor - 1.0) < 0.01,
      `  ${path}: scaleFactor = ${node.layout.scaleFactor.toFixed(3)} (should be 1.0)`
    );
  } else {
    assert(false, `  ${path}: Node not found or missing layout`);
  }
});

console.log('\nTest 2: Non-git-root directories scale up to contain children');
const directories = [
  { path: 'b/chat', expectedScaleFactorMin: 1.1 },
  { path: 'b', expectedScaleFactorMin: 1.1 },
  { path: 'a', expectedScaleFactorMin: 1.0 }
];

directories.forEach(({ path, expectedScaleFactorMin }) => {
  const node = findNode(data.tree, path);
  if (node && node.layout) {
    assert(
      node.layout.scaleFactor >= expectedScaleFactorMin,
      `  ${path}: scaleFactor = ${node.layout.scaleFactor.toFixed(3)} (should be >= ${expectedScaleFactorMin})`
    );
  } else {
    assert(false, `  ${path}: Node not found or missing layout`);
  }
});

console.log('\nTest 3: Children fit within parent circles (with 1% tolerance)');

function testChildContainment(parentPath, childNames) {
  const parent = findNode(data.tree, parentPath);
  if (!parent || !parent.layout) {
    assert(false, `  ${parentPath}: Parent not found or missing layout`);
    return;
  }

  // All coordinates are in absolute (root) space
  const parentCenter = parent.layout.center || [0, 0];
  const parentRadius = parent.layout.radius || 0;

  childNames.forEach(childName => {
    const child = parent.children?.find(c => c.name === childName);
    if (!child || !child.layout) {
      assert(false, `  ${parentPath}/${childName}: Child not found or missing layout`);
      return;
    }

    // Child's center is also in absolute (root) space
    const childCenter = child.layout.center || [0, 0];
    const childRadius = child.layout.radius || 0;
    const dist = distance(parentCenter, childCenter);
    const required = childRadius + dist;
    const tolerance = parentRadius * 0.01; // 1% tolerance

    assert(
      parentRadius + tolerance >= required,
      `  ${parentPath} → ${childName}: parent radius ${parentRadius.toFixed(0)}, child needs ${required.toFixed(0)} (dist=${dist.toFixed(0)}, childR=${childRadius.toFixed(0)})`
    );
  });
}

testChildContainment('', ['a', 'b']);  // root contains a and b
testChildContainment('b', ['b1', 'chat']);  // b contains b1 and chat
testChildContainment('b/chat', ['chat-service', 'chat-snap-in', 'pii-removal', 'video-chat-widget']);

console.log('\nTest 4: Siblings touch but don\'t overlap (circle packing constraint)');

function testSiblingPacking(parentPath, child1Name, child2Name) {
  const parent = findNode(data.tree, parentPath);
  if (!parent || !parent.children) {
    assert(false, `  ${parentPath}: Parent not found or has no children`);
    return;
  }

  const child1 = parent.children.find(c => c.name === child1Name);
  const child2 = parent.children.find(c => c.name === child2Name);

  if (!child1?.layout || !child2?.layout) {
    assert(false, `  ${parentPath}: Children ${child1Name} or ${child2Name} missing layout`);
    return;
  }

  const c1Center = child1.layout.center || [0, 0];
  const c1Radius = child1.layout.radius || 0;
  const c2Center = child2.layout.center || [0, 0];
  const c2Radius = child2.layout.radius || 0;

  const dist = distance(c1Center, c2Center);
  const sumRadii = c1Radius + c2Radius;
  const tolerance = sumRadii * 0.05; // 5% tolerance for approximate layouts

  // Circles should touch (dist ≈ r1 + r2) but not overlap significantly (dist < r1 + r2)
  const touching = Math.abs(dist - sumRadii) < tolerance;
  const notOverlapping = dist >= sumRadii * 0.95; // Allow 5% overlap for approximation

  assert(
    touching || notOverlapping,
    `  ${child1Name} & ${child2Name}: distance=${dist.toFixed(0)}, sum of radii=${sumRadii.toFixed(0)} (${touching ? 'touching' : notOverlapping ? 'separated' : 'overlapping'})`
  );
}

testSiblingPacking('', 'a', 'b');
testSiblingPacking('b', 'b1', 'chat');

console.log('\n=== Summary ===');
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

process.exit(failCount > 0 ? 1 : 0);
