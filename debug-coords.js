const fs = require('fs');
const data = JSON.parse(fs.readFileSync('manual_test/out/manual-test-output.json', 'utf8'));

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

const root = data.tree;
const a = findNode(root, 'a');
const b = findNode(root, 'b');

console.log('Root:', {
  center: root.layout.center,
  radius: root.layout.radius,
  naturalRadius: root.layout.naturalRadius,
  scaleFactor: root.layout.scaleFactor
});

console.log('\nChild a:', {
  center: a.layout.center,
  radius: a.layout.radius,
  naturalRadius: a.layout.naturalRadius,
  scaleFactor: a.layout.scaleFactor
});

console.log('\nChild b:', {
  center: b.layout.center,
  radius: b.layout.radius,
  naturalRadius: b.layout.naturalRadius,
  scaleFactor: b.layout.scaleFactor
});

console.log('\nChild b children:');
b.children.forEach(child => {
  console.log(child.name, ':', {
    center: child.layout.center,
    radius: child.layout.radius
  });
});

// Calculate what d3.packEnclose would give us
const d3 = require('d3');

const aCircle = { x: a.layout.center[0], y: a.layout.center[1], r: a.layout.radius };
const bCircle = { x: b.layout.center[0], y: b.layout.center[1], r: b.layout.radius };
const enclosing = d3.packEnclose([aCircle, bCircle]);

console.log('\nd3.packEnclose([a, b]):', enclosing);
console.log('But root.layout.radius is:', root.layout.radius);
