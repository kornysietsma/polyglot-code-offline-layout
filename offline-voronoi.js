import { promises as fs, existsSync } from 'fs';
import yargs from 'yargs';
import dvm from 'd3-voronoi-map';

const voronoiMapSimulation = dvm.voronoiMapSimulation;

const debug = false;

import d3 from 'd3';
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
  node.layout = {
    polygon: clipPolygon,
    center,
    algorithm: 'voronoi',
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
    console.log(
      `calculating voronoi for ${name} with ${node.children.length} children and a clip polygon with ${clipPolygon.length} vertices`
    );
  }

  let currentOverweightedAlgorithm = 1; // algorithm 0 is more stable but maybe not as good?
  const ALGORITHM_CHANGE_COUNT = 20; // generally algorithm 1 either works pretty quickly, or not at all. So switch pretty quickly if it fails
  const MAX_SIMULATION_COUNT = 200; // we re-run the whole simulation this many times if it fails
  const MAX_ITERATION_COUNT = 500; // this is how many times a particular simulation iterates
  const MIN_WEIGHT_RATIO = 0.005; // maybe this should be a parameter? Too high, we iterate a lot.  Too low, sizes are not proportional to lines of code.
  // TODO: store the best simulation so far for a particular simulation?
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
        .overweightedAlgorithm(currentOverweightedAlgorithm)
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
          console.log(
            `slow voronoi processing of ${name} with ${node.children.length} children, tick count: ${tickCount}`
          );
        }
        simulation.tick();
        state = simulation.state();
      }
      if (tickCount === MAX_ITERATION_COUNT) {
        if (state.convergenceRatio < bestConvergenceRatio) {
          console.log(
            'best iteration result so far',
            simulationCount,
            state.convergenceRatio
          );
          bestConvergenceRatio = state.convergenceRatio;
          bestPolygons = [...state.polygons];
        }

        if (simulationCount < MAX_SIMULATION_COUNT) {
          simulationCount = simulationCount + 1;

          console.log(
            `processing ${name} with ${node.children.length} children - Exceeded tick count ${tickCount} - retrying from scratch, try ${simulationCount}`
          );
          if (
            simulationCount >= ALGORITHM_CHANGE_COUNT &&
            currentOverweightedAlgorithm == 1
          ) {
            currentOverweightedAlgorithm = 0;
            console.warn(
              `after ${simulationCount} attempts, switching to alternative handleOverweight algorithm ${currentOverweightedAlgorithm}`
            );
          }
        } else {
          console.error('Too many meta retries - stopping');
          simulationLoopEnded = true;
          if (!goodenough) {
            throw Error("Too many retries, can't provide good simulation");
          } else {
            console.log('returning good-enough result', bestConvergenceRatio);
          }
        }
      } else {
        if (bestPolygons) {
          console.log(
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
      console.log('caught e', e.message);
      if (!(e instanceof Error) && !(e instanceof TypeError)) {
        console.error('not Error or TypeError');
        throw e;
      }
      if (
        e.message == 'bad_polygons' ||
        e.message == 'overweight_loop' ||
        e.message === "Cannot set property 'twin' of null"
      ) {
        simulationCount = simulationCount + 1;
        if (simulationCount < MAX_SIMULATION_COUNT) {
          console.log(`caught ${e.message}, retrying`, simulationCount);
          if (
            simulationCount >= ALGORITHM_CHANGE_COUNT &&
            currentOverweightedAlgorithm == 1
          ) {
            currentOverweightedAlgorithm = 0;
            console.log(
              `after ${simulationCount} attempts, switching to alternative handleOverweight algorithm ${currentOverweightedAlgorithm}`
            );
          }
        } else {
          console.error(
            `caught ${e.message}, too many errors!`,
            simulationCount
          );
          simulationLoopEnded = true;
          if (!goodenough) {
            throw Error("Too many retries, can't provide good simulation");
          } else {
            console.log('returning good-enough result', bestConvergenceRatio);
          }
        }
      } else {
        console.error(`unhandled exception ${e.message} - rethrowing`);
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
    console.log(
      'Successful layout - best convergence ratio',
      state.convergenceRatio
    );
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

async function main({ input, output, points, circles, goodenough }) {
  const rawData = await fs.readFile(input, 'utf-8');
  const width = 1024;
  const parsedData = JSON.parse(rawData);

  console.log('getting values recursively');
  calculate_values(parsedData);
  console.log('pruning empty nodes');
  pruneWeightlessNodes(parsedData);

  // top level clip shape
  if (circles) {
    // area = pi r^2 so r = sqrt(area/pi) or just use sqrt(area) for simplicity
    const children = parsedData.children.map((child) => {
      return { r: Math.sqrt(child.value), originalObject: child };
    });
    d3.packSiblings(children);
    // top level layout
    const enclosingCirle = d3.packEnclose(children);
    const { x, y, r } = enclosingCirle;
    // TODO: offset by x/y
    parsedData.layout = {
      polygon: computeCirclingPolygon(points, r),
      center: [0, 0],
      width: r * 2,
      height: r * 2,
      algorithm: 'circlePack',
    };

    for (const child of children) {
      const clipPolygon = computeCirclingPolygon(
        points,
        child.r
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
      child.originalObject.layout.width = child.r;
      child.originalObject.layout.height = child.r;
    }
  } else {
    const clipPolygon = computeCirclingPolygon(points, width / 2);
    const center = [0, 0];

    calculateVoronoi(null, parsedData, clipPolygon, center, goodenough, 0);

    parsedData.layout.width = width;
    parsedData.layout.height = width;
  }

  const results = addPaths(null, parsedData);

  console.warn('saving');
  await fs.writeFile(output, JSON.stringify(results));
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
  .demandOption(['i', 'o'])
  .help('h')
  .alias('h', 'help')
  .check((argv) => {
    if (existsSync(argv.i)) {
      return true;
    }
    throw new Error(`Argument check failed: ${argv.i} does not exist`);
  }).argv;

const args = {
  input: argv.input,
  output: argv.output,
  points: argv.points,
  circles: argv.circles,
  goodenough: argv.goodenough,
};

main(args).then(
  (result) => {
    console.error('done.', result);
  },
  (err) => {
    console.error('Error thrown!', err);
  }
);
