#!/usr/bin/env node

const { createReadStream, createWriteStream } = require('fs');
const yargs = require('yargs');
const dvm = require('d3-voronoi-map');
const d3 = require('d3');
const { parser } = require('stream-json');
const { Assembler } = require('stream-json/assembler.js');
const { disassembler } = require('stream-json/disassembler.js');
const { stringer } = require('stream-json/stringer.js');
const { none } = require('stream-chain/core');

const voronoiMapSimulation = dvm.voronoiMapSimulation;

const debug = false;

// import vtm from 'd3-voronoi-treemap';

function computeCirclingPolygon(points, radius) {
  const increment = (2 * Math.PI) / points;
  const circlingPolygon = [];

  for (let a = 0, i = 0; i < points; i++, a += increment) {
    circlingPolygon.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }

  return circlingPolygon;
}

function flareWeightLoc(d) {
  if (d.data === undefined) return 0;
  if (d.data.loc === undefined) return 0;
  return d.data.loc.code;
}

function pruneWeightlessNodes(hierarchy) {
  if (hierarchy.children !== undefined) {
    // eslint-disable-next-line no-param-reassign
    hierarchy.children = hierarchy.children.filter((node) => node.value > 0);
    hierarchy.children.forEach((child) => pruneWeightlessNodes(child));
  }
}

function addPaths(pathSoFar, node) {
  let path;
  if (pathSoFar === null) {
    path = ''; // not 'flare' - could use '/' or null - but this is nicer for output
  } else {
    if (pathSoFar === '') {
      path = node.name;
    } else {
      path = `${pathSoFar}/${node.name}`;
    }
  }
  const children = node.children
    ? node.children.map((n) => addPaths(path, n))
    : undefined;
  return {
    name: node.name,
    path,
    children: children,
    layout: node.layout,
    value: node.value,
    data: node.data,
  };
}

function isGitRepoRoot(node) {
  // A directory is a git repo root if it has data.git with remote_url or head fields
  // Directory git roots have: {remote_url, head}
  // File git data has: {activity, age_in_days, creation_date, details, last_update, user_count, users}
  if (debug && node.data?.git) {
    console.warn(
      `Node ${node.name} has git data:`,
      JSON.stringify(node.data.git).substring(0, 100)
    );
  }
  return node.data?.git && (node.data.git.remote_url || node.data.git.head);
}

// Helper: Calculate the required radius to enclose all packed circles
// when the enclosing circle must be centered at origin [0, 0]
function calculateEnclosingRadius(packedChildren) {
  if (packedChildren.length === 0) return 0;
  if (packedChildren.length === 1) {
    // Single child: enclosing radius is distance from origin to child's edge
    return Math.sqrt(packedChildren[0].x ** 2 + packedChildren[0].y ** 2) + packedChildren[0].r;
  }
  
  // Multiple children: find the maximum distance from origin to any child's edge
  let maxDist = 0;
  for (const child of packedChildren) {
    const distToCenter = Math.sqrt(child.x ** 2 + child.y ** 2);
    const distToEdge = distToCenter + child.r;
    if (distToEdge > maxDist) {
      maxDist = distToEdge;
    }
  }
  return maxDist;
}

// Helper: record the bounding-circle metrics of a circle-packed node.
// calculateVoronoi() replaces node.layout wholesale, so any node that was
// *positioned* by circle packing but whose *contents* are laid out by voronoi
// (i.e. every git repo root) must have these re-applied afterwards - otherwise
// it loses width/height, which consumers use to size the node.
function applyCircleMetrics(node, radius, naturalRadius) {
  node.layout.width = radius * 2;
  node.layout.height = radius * 2;
  node.layout.radius = radius;
  node.layout.naturalRadius = naturalRadius;
  node.layout.scaleFactor = naturalRadius > 0 ? radius / naturalRadius : 1.0;
}

// Helper: Translate all coordinates in a subtree by an offset
function translateSubtree(node, offsetX, offsetY) {
  if (node.layout) {
    node.layout.center = [node.layout.center[0] + offsetX, node.layout.center[1] + offsetY];
    node.layout.polygon = node.layout.polygon.map(([x, y]) => [x + offsetX, y + offsetY]);
  }
  if (node.children) {
    for (const child of node.children) {
      translateSubtree(child, offsetX, offsetY);
    }
  }
}

function packChildren(
  nameSoFar,
  node,
  points,
  goodenough,
  depth,
  nestedMode,
  parentCenter = [0, 0]
) {
  // Apply circle packing to direct children and recurse (bottom-up packing with scaling)
  // parentCenter is the absolute position of this node in root coordinate space
  const name = nameSoFar ? `${nameSoFar}/${node.name}` : node.name;

  if (!node.children || node.children.length === 0) {
    return;
  }

  // Step 1: Recursively pack all children FIRST (depth-first, bottom-up)
  // and compute their actualRadius before packing siblings
  // Children are packed relative to [0,0] and will be translated later
  for (const child of node.children) {
    if (nestedMode && isGitRepoRoot(child)) {
      // Git repo root: will use voronoi, no packing needed here
      // Layout will be set later in the git repo root handler
      continue;
    }
    if (child.children && child.children.length > 0) {
      // Recursively pack non-git-root children relative to [0,0]
      packChildren(
        name,
        child,
        points,
        goodenough,
        depth + 1,
        nestedMode,
        [0, 0]  // Pack relative to origin, will translate later
      );
    }
  }

  // Step 2: Compute actualRadius for each child BEFORE packing
  // This is needed because packing should use the actual visual size (which may be scaled)
  const childRadii = new Map();
  for (const child of node.children) {
    let actualRadius = Math.sqrt(child.value);
    
    // For non-git-root nodes with children, check if they need a larger radius
    if (nestedMode && !isGitRepoRoot(child) && child.children && child.children.length > 0) {
      const packedChildrenRadii = child.children
        .filter(gc => gc.layout)
        .map(gc => {
          const childCenter = gc.layout.center || [0, 0];
          const childRadius = gc.layout.radius || (gc.layout.width / 2) || 0;
          return {
            x: childCenter[0],
            y: childCenter[1],
            r: childRadius
          };
        });
      
      if (packedChildrenRadii.length > 0) {
        const requiredRadius = calculateEnclosingRadius(packedChildrenRadii);
        if (requiredRadius > actualRadius) {
          actualRadius = requiredRadius;
        }
      }
    }
    
    childRadii.set(child, actualRadius);
  }

  // Step 3: Pack siblings using their actualRadius values
  const children = node.children.map((child) => {
    return { r: childRadii.get(child), originalObject: child };
  });

  // packSiblings centres its result on the enclosing circle, so children are
  // already positioned relative to [0,0] - no packEnclose offset is needed here.
  d3.packSiblings(children);

  if (depth < 3) {
    console.warn(
      `circle packing for ${name} with ${node.children.length} children`
    );
  } else if (depth === 3) {
    console.warn(
      `circle packing for ${name} and descendants with ${node.children.length} children`
    );
  }

  // Step 4: Process each packed child and set its layout
  for (const child of children) {
    const naturalRadius = Math.sqrt(child.originalObject.value);
    const actualRadius = child.r; // This is the radius we used for packing (from childRadii map)
    const scaleFactor = actualRadius / naturalRadius;
    
    if (depth < 3 && scaleFactor > 1.0) {
      console.warn(
        `scaling ${child.originalObject.name}: natural=${naturalRadius.toFixed(2)}, actual=${actualRadius.toFixed(2)}, scaleFactor=${scaleFactor.toFixed(3)}`
      );
    }

    // Position child in ABSOLUTE coordinate system
    // child.x and child.y are positions from d3.packSiblings (relative to parent's origin)
    // Add parentCenter to get absolute position
    const absoluteCenter = [parentCenter[0] + child.x, parentCenter[1] + child.y];
    const clipPolygon = computeCirclingPolygon(points, actualRadius).map(
      ([x, y]) => [absoluteCenter[0] + x, absoluteCenter[1] + y]
    );

    child.originalObject.layout = {
      polygon: clipPolygon,
      center: absoluteCenter,
      width: actualRadius * 2,
      height: actualRadius * 2,
      algorithm: 'circlePack',
      radius: actualRadius,
      naturalRadius: naturalRadius,
      scaleFactor: scaleFactor,
    };
    
    // Now that we know the child's absolute position, translate its subtree
    // Children were packed relative to [0,0] in Step 1, now translate to absoluteCenter
    if (nestedMode && !isGitRepoRoot(child.originalObject) && child.originalObject.children) {
      for (const grandchild of child.originalObject.children) {
        translateSubtree(grandchild, absoluteCenter[0], absoluteCenter[1]);
      }
    }

    if (nestedMode && isGitRepoRoot(child.originalObject)) {
      // Hit a git repo root - switch to voronoi for this subtree
      if (debug) {
        console.warn(
          `detected git repo root at ${child.originalObject.name}, switching to voronoi`
        );
      }
      calculateVoronoi(
        child.originalObject.name,
        child.originalObject,
        clipPolygon,
        absoluteCenter,
        goodenough,
        depth + 1
      );
      // calculateVoronoi replaced the layout set above - restore the circle metrics
      applyCircleMetrics(child.originalObject, actualRadius, naturalRadius);
    } else if (!nestedMode && child.originalObject.children) {
      // Original top-level circles mode - apply voronoi to children (without nested mode)
      calculateVoronoi(
        child.originalObject.name,
        child.originalObject,
        clipPolygon,
        absoluteCenter,
        goodenough,
        depth + 1
      );
      applyCircleMetrics(child.originalObject, actualRadius, naturalRadius);
    }
  }
}

function calculateNestedCircles(
  nameSoFar,
  node,
  points,
  goodenough,
  depth,
  parentCenter = [0, 0]
) {
  const name = nameSoFar ? `${nameSoFar}/${node.name}` : node.name;

  // Check if this is a git repo root
  if (isGitRepoRoot(node)) {
    // At repo root: apply voronoi to all descendants.
    // Size the clip circle by sqrt(value), the same scale used by every other
    // circle in this mode, so that a tree which is itself one repo has the same
    // area:loc ratio as a repo nested inside directories.
    if (debug) {
      console.warn(`git repo root detected at ${name}, applying voronoi`);
    }
    const naturalRadius = Math.sqrt(node.value || 0);
    const clipPolygon = computeCirclingPolygon(points, naturalRadius);
    const center = [0, 0];
    calculateVoronoi(name, node, clipPolygon, center, goodenough, depth);
    applyCircleMetrics(node, naturalRadius, naturalRadius);
    return;
  }

  if (!node.children || node.children.length === 0) {
    // Leaf node - no layout needed beyond parent
    return;
  }

  // Not a repo root: apply circle packing and recurse
  packChildren(name, node, points, goodenough, depth, true, parentCenter);
  
  // After packing children, calculate this node's radius to enclose them
  const naturalRadius = Math.sqrt(node.value || 0);
  let actualRadius = naturalRadius;
  let scaleFactor = 1.0;
  
  const packedChildrenRadii = node.children
    .filter(child => child.layout) // only children that have been packed
    .map(child => {
      const childCenter = child.layout.center || [0, 0];
      const childRadius = child.layout.radius || (child.layout.width / 2) || 0;
      // NOTE: child.layout.radius is already actualRadius (scaled if needed), so don't multiply by scaleFactor again
      return {
        x: childCenter[0],
        y: childCenter[1],
        r: childRadius
      };
    });

  if (packedChildrenRadii.length > 0) {
    const requiredRadius = calculateEnclosingRadius(packedChildrenRadii);
    if (requiredRadius > naturalRadius) {
      actualRadius = requiredRadius;
      scaleFactor = actualRadius / naturalRadius;
      if (depth < 3) {
        console.warn(
          `scaling root node: natural=${naturalRadius.toFixed(2)}, required=${requiredRadius.toFixed(2)}, scaleFactor=${scaleFactor.toFixed(3)}`
        );
      }
      // NOTE: We do NOT scale child positions!
      // The children are already optimally packed by d3.packSiblings at their current positions.
      // We simply record that the root needs a bigger radius (actualRadius) to contain them.
      // scaleFactor is just metadata showing how much bigger the root needs to be.
    }
  }
  
  // Set the root node's layout
  node.layout = {
    polygon: computeCirclingPolygon(points, actualRadius),
    center: [0, 0],
    algorithm: 'nestedCircles',
    width: actualRadius * 2,
    height: actualRadius * 2,
    radius: actualRadius,
    naturalRadius: naturalRadius,
    scaleFactor: scaleFactor,
  };
}


function calculate_values(node) {
  if (node.children) {
    for (const n of node.children) {
      calculate_values(n);
    }
    const tot = node.children.map((n) => n.value).reduce((a, b) => a + b, 0);
    node.value = tot;
  } else {
    node.value = flareWeightLoc(node);
  }
}

function calculateVoronoi(
  nameSoFar,
  node,
  clipPolygon,
  center,
  goodenough,
  depth
) {
  const name = nameSoFar ? `${nameSoFar}/${node.name}` : node.name;
  const value = node.value || 0;
  // NOTE: for a voronoi node `radius` is notional - it is the radius a circle of
  // this node's area would have, NOT a bounding radius for `polygon`, which is an
  // arbitrary convex cell. Only circle-packed nodes (see applyCircleMetrics) have
  // a radius that bounds their polygon. Don't use it for containment or hit tests.
  const naturalRadius = Math.sqrt(value);
  node.layout = {
    polygon: clipPolygon,
    center,
    algorithm: 'voronoi',
    radius: naturalRadius,
    naturalRadius: naturalRadius,
    scaleFactor: 1.0, // Voronoi/git-roots always have 1:1 scaling
  };

  if (!node.children) {
    return;
  }
  if (depth < 3) {
    console.warn(`calculating voronoi for ${name}`);
  } else if (depth === 3) {
    console.warn(`calculating voronoi for ${name} and descendants`);
  }
  if (debug) {
    console.warn(
      `calculating voronoi for ${name} with ${node.children.length} children and a clip polygon with ${clipPolygon.length} vertices`
    );
  }

  const MAX_SIMULATION_COUNT = 200; // we re-run the whole simulation this many times if it fails
  const MAX_ITERATION_COUNT = 500; // this is how many times a particular simulation iterates
  const MIN_WEIGHT_RATIO = 0.005; // maybe this should be a parameter? Too high, we iterate a lot.  Too low, sizes are not proportional to lines of code.
  let simulationCount = 0;
  let simulationLoopEnded = false;
  let bestConvergenceRatio = 1.0;
  let bestPolygons = undefined;
  while (!simulationLoopEnded) {
    try {
      var simulation = voronoiMapSimulation(node.children)
        .maxIterationCount(MAX_ITERATION_COUNT)
        .minWeightRatio(MIN_WEIGHT_RATIO)
        .weight((d) => d.value)
        .clip(clipPolygon)
        .stop();

      var state = simulation.state();

      let tickCount = 0;
      let warningTime = Date.now();
      while (!state.ended) {
        tickCount += 1;
        const now = Date.now();
        if (now - warningTime > 10000) {
          // every 10 seconds
          warningTime = now;
          console.warn(
            `slow voronoi processing of ${name} with ${node.children.length} children, tick count: ${tickCount}`
          );
        }
        simulation.tick();
        state = simulation.state();
      }
      if (tickCount === MAX_ITERATION_COUNT) {
        if (state.convergenceRatio < bestConvergenceRatio) {
          if (debug) {
            console.warn(
              'best iteration result so far',
              simulationCount,
              state.convergenceRatio
            );
          }
          bestConvergenceRatio = state.convergenceRatio;
          bestPolygons = [...state.polygons];
        }

        if (simulationCount < MAX_SIMULATION_COUNT) {
          simulationCount = simulationCount + 1;

          console.warn(
            `processing ${name} with ${node.children.length} children - Exceeded tick count ${tickCount} - retrying from scratch, try ${simulationCount} of ${MAX_SIMULATION_COUNT}`
          );
        } else {
          console.error('Too many meta retries - stopping');
          simulationLoopEnded = true;
          if (!goodenough) {
            throw Error("Too many retries, can't provide good simulation");
          } else {
            console.warn('returning good-enough result', bestConvergenceRatio);
          }
        }
      } else {
        if (bestPolygons) {
          console.warn(
            'successful converging layout, using real ratio not best-so-far: ',
            state.convergenceRatio
          );
          bestPolygons = undefined;
          bestConvergenceRatio = state.convergenceRatio;
        }
        simulationLoopEnded = true;
      }
    } catch (e) {
      // re-try from scratch but only after predictable exceptions
      console.warn('caught e', e.message);
      if (!(e instanceof Error) && !(e instanceof TypeError)) {
        console.error('not Error or TypeError');
        throw e;
      }
      if (
        e.message === 'handleOverweighted1 is looping too much' ||
        e.message ===
          'at least 1 site has no area, which is not supposed to arise'
      ) {
        simulationCount = simulationCount + 1;
        if (simulationCount < MAX_SIMULATION_COUNT) {
          console.warn(
            `caught ${e.message}, retrying from scratch try ${simulationCount} of ${MAX_SIMULATION_COUNT}`
          );
        } else {
          console.error(
            `caught ${e.message}, too many errors!`,
            simulationCount
          );
          simulationLoopEnded = true;
          if (!goodenough) {
            throw Error("Too many retries, can't provide good simulation");
          } else {
            console.warn('returning good-enough result', bestConvergenceRatio);
          }
        }
      } else {
        console.error(
          `unhandled exception ${e.name}:${e.message} - rethrowing`
        );
        throw e;
      }
    }
  }
  var polygons = state.polygons;
  if (bestPolygons) {
    console.error(
      'No good layout found - using best convergence ratio',
      bestConvergenceRatio
    );
    polygons = bestPolygons;
  } else {
    if (debug) {
      console.warn(
        'Successful layout - best convergence ratio',
        state.convergenceRatio
      );
    }
  }

  for (const polygon of polygons) {
    const pdata = polygon.map((d) => d);
    calculateVoronoi(
      name,
      polygon.site.originalObject.data.originalData,
      pdata,
      [polygon.site.x, polygon.site.y],
      goodenough,
      depth + 1
    );
  }
}

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readLargeFile(filePath) {
  // Stream-parse so we never hold the raw JSON text in memory, and avoid
  // big-json's write-side stringifier (see writeLargeJson) - use stream-json
  // for both directions instead.
  console.warn('using streaming JSON parser');
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath).pipe(parser.asStream());
    stream.on('error', reject);
    Assembler.connectTo(stream, {
      onDone: (asm) => {
        console.warn('finished parsing JSON');
        resolve(asm.current);
      },
    });
  });
}

async function writeLargeJson(filePath, obj) {
  // big-json's createStringifyStream (json-stream-stringify) is catastrophically
  // slow on large nested objects - it can take hours on a big repo tree (see
  // https://github.com/DonutEspresso/big-json/issues/24). stream-json's
  // disassembler/stringer generators, driven directly against the write
  // stream, are ~30x faster for the same data.
  const dump = disassembler({ packValues: true, streamValues: false });
  const stringify = stringer({ useValues: true });
  const writeStream = createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
    (async () => {
      for (const token of dump(obj)) {
        const str = stringify(token);
        if (str !== none && !writeStream.write(str)) {
          await new Promise((res) => writeStream.once('drain', res));
        }
      }
      const tail = stringify(none);
      if (tail !== none) writeStream.write(tail);
      writeStream.end();
    })().catch(reject);
  });
}

async function main({ input, output, points, circles, nestedCircles, goodenough }) {
  const parsedData = input
    ? await readLargeFile(input)
    : await (async () => {
        const rawData = await read(process.stdin);
        return JSON.parse(rawData);
      })();
  const width = 1024;

  console.warn('getting values recursively');
  const treeData = parsedData['tree'];

  calculate_values(treeData);
  console.warn('pruning empty nodes');
  pruneWeightlessNodes(treeData);

  // Handle nested circles mode
  if (nestedCircles) {
    console.warn('using nested circle packing until git repo root');
    const clipPolygon = computeCirclingPolygon(points, width / 2);
    const center = [0, 0];
    const value = treeData.value || 0;
    const naturalRadius = Math.sqrt(value);

    treeData.layout = {
      polygon: clipPolygon,
      center,
      algorithm: 'nestedCircles',
      width,
      height: width,
      radius: naturalRadius,
      naturalRadius: naturalRadius,
      scaleFactor: 1.0,
    };

    calculateNestedCircles(null, treeData, points, goodenough, 0);
  } else if (circles) {
    // top level circle packing mode
    // area = pi r^2 so r = sqrt(area/pi) or just use sqrt(area) for simplicity
    const children = treeData.children.map((child) => {
      return { r: Math.sqrt(child.value), originalObject: child };
    });
    // packSiblings centres its result on the enclosing circle, so packEnclose
    // gives us the radius we need with no x/y offset to apply.
    d3.packSiblings(children);
    // top level layout
    const { r } = d3.packEnclose(children);
    const naturalRadius = r;
    treeData.layout = {
      polygon: computeCirclingPolygon(points, r),
      center: [0, 0],
      width: r * 2,
      height: r * 2,
      algorithm: 'circlePack',
      radius: r,
      naturalRadius: naturalRadius,
      scaleFactor: 1.0,
    };

    for (const child of children) {
      const childRadius = child.r;
      const childNaturalRadius = Math.sqrt(child.originalObject.value);
      const clipPolygon = computeCirclingPolygon(
        points,
        childRadius
      ).map(([x, y]) => [x + child.x, y + child.y]);
      const center = [child.x, child.y];

      calculateVoronoi(
        child.originalObject.name,
        child.originalObject,
        clipPolygon,
        center,
        goodenough,
        1
      );
      applyCircleMetrics(child.originalObject, childRadius, childNaturalRadius);
    }
  } else {
    // voronoi-only mode
    const clipPolygon = computeCirclingPolygon(points, width / 2);
    const center = [0, 0];
    const value = treeData.value || 0;
    const naturalRadius = Math.sqrt(value);

    calculateVoronoi(null, treeData, clipPolygon, center, goodenough, 0);

    treeData.layout.width = width;
    treeData.layout.height = width;
    treeData.layout.radius = naturalRadius;
    treeData.layout.naturalRadius = naturalRadius;
    treeData.layout.scaleFactor = 1.0;
  }

  const treeWithPaths = addPaths(null, treeData);

  parsedData['tree'] = treeWithPaths;

  console.warn('saving');
  if (output) {
    await writeLargeJson(output, parsedData);
  } else {
    process.stdout.write(JSON.stringify(parsedData));
  }
  return 'OK';
}

const argv = yargs
  //   .usage('$0 -i [input]', 'add voronoi data to json input file')
  .usage('$0 [options]')
  .alias('i', 'input')
  .describe('i', 'Input JSON file')
  .alias('o', 'output')
  .describe('o', 'Output JSON file')
  .alias('p', 'points')
  .number('p')
  .default('p', 128)
  .describe('p', 'number of points in the initial bounding circle/polygon')
  .boolean('g')
  .alias('g', 'goodenough')
  .default('g', true)
  .describe(
    'g',
    'accept a good-enough voronoi simulation, rather than failing if perfect one not found'
  )
  .describe('c', 'use circle packing for top level')
  .boolean('c')
  .alias('c', 'circles')
  .default('c', false)
  .describe('n', 'use nested circle packing until git repo root, then voronoi')
  .boolean('n')
  .alias('n', 'nested-circles')
  .default('n', false)
  .help('h')
  .alias('h', 'help').argv;

const args = {
  input: argv.input,
  output: argv.output,
  points: argv.points,
  circles: argv.circles,
  nestedCircles: argv['nested-circles'],
  goodenough: argv.goodenough,
};

main(args).then(
  (result) => {
    console.error('done.', result);
  },
  (err) => {
    console.error('Error thrown!', err);
    process.exit(1);
  }
);
