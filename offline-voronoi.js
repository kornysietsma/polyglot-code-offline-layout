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

function calculateVoronoi(nameSoFar, node, clipPolygon, center) {
  const name = nameSoFar ? `${nameSoFar}/${node.name}` : node.name;
  node.layout = {
    polygon: clipPolygon,
    center,
    algorithm: 'voronoi',
  };

  if (!node.children) {
    return;
  }
  if (debug) {
    console.log(
      `calculating map for ${name} with ${node.children.length} children and a clip polygon with ${clipPolygon.length} vertices`
    );
  }

  const MY_MAX_COUNT = 500;
  let metaCount = 0;
  let metaEnded = false;
  const META_MAX_COUNT = 100;
  while (!metaEnded) {
    try {
      var simulation = voronoiMapSimulation(node.children)
        .maxIterationCount(MY_MAX_COUNT)
        .minWeightRatio(0.01)
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
          console.log(
            `slow voronoi processing of ${name} with ${node.children.length} children, tick count: ${tickCount}`
          );
        }
        simulation.tick();
        state = simulation.state();
      }
      if (tickCount === MY_MAX_COUNT) {
        if (metaCount < META_MAX_COUNT) {
          metaCount = metaCount + 1;
          console.log(
            `processing ${name} with ${node.children.length} children - Exceeded tick count ${tickCount} - retrying from scratch, try ${metaCount}`
          );
        } else {
          console.error('Too many meta retries - stopping anyway');
          metaEnded = true;
        }
      } else {
        metaEnded = true;
      }
    } catch (e) {
      // re-try from scratch but only after predictable exceptions
      console.error('caught e', e);
      if (!e instanceof Error) {
        console.error('not Error');
        throw e;
      }
      if (e.message == 'bad_polygons' || e.message == 'overweight_loop') {
        metaCount = metaCount + 1;
        if (metaCount < META_MAX_COUNT) {
          console.error(`caught ${e.message}, retrying`, metaCount);
        } else {
          console.error(`caught ${e.message}, too many errors!`, metaCount);
          metaEnded = true; // but fail anyway
          throw e;
        }
      } else {
        console.error(`unhandled exception ${e.message} - rethrowing`);
        throw e;
      }
    }
  }
  var polygons = state.polygons;

  for (const polygon of polygons) {
    const pdata = polygon.map((d) => d);
    calculateVoronoi(
      name,
      polygon.site.originalObject.data.originalData,
      pdata,
      [polygon.site.x, polygon.site.y]
    );
  }
}

async function main({ input, output, points, circles }) {
  const rawData = await fs.readFile(input, 'utf-8');
  const width = 1024;
  const parsedData = JSON.parse(rawData);
  //   console.log(parsedData);
  console.log('getting values recursively');
  calculate_values(parsedData);
  console.log('pruning empty nodes');
  pruneWeightlessNodes(parsedData);

  // top level clip shape
  if (circles) {
    // area = pi r^2 so r = sqrt(area/pi) or just use sqrt(area) for simplicity
    console.log('getting children');
    const children = parsedData.children.map((child) => {
      console.log('child weight', child.value);
      return { r: Math.sqrt(child.value), originalObject: child };
    });
    d3.packSiblings(children);
    console.log('children', children);
    // top level layout
    const enclosingCirle = d3.packEnclose(children);
    const { x, y, r } = enclosingCirle;
    // TODO: offset by x/y
    console.log('enclosing circle radius', r);
    parsedData.layout = {
      polygon: computeCirclingPolygon(points, r),
      center: [0, 0],
      width: r * 2,
      height: r * 2,
      algorithm: 'circlePack',
    };
    console.log('top layout', parsedData.layout);

    for (const child of children) {
      const clipPolygon = computeCirclingPolygon(
        points,
        child.r
      ).map(([x, y]) => [x + child.x, y + child.y]);
      const center = [child.x, child.y];
      console.log('calculating voronoi for ', child.originalObject.name);
      calculateVoronoi(
        child.originalObject.name,
        child.originalObject,
        clipPolygon,
        center
      );
      child.originalObject.layout.width = child.r;
      child.originalObject.layout.height = child.r;
    }
  } else {
    const clipPolygon = computeCirclingPolygon(points, width / 2);
    const center = [0, 0];

    calculateVoronoi(null, parsedData, clipPolygon, center);

    parsedData.layout.width = width;
    parsedData.layout.height = width;
  }

  const results = addPaths(null, parsedData);

  console.log('saving');
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
};

main(args).then(
  (result) => {
    console.error('done.', result);
  },
  (err) => {
    console.error('Error thrown!', err);
  }
);
