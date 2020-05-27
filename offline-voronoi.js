import { promises as fs, existsSync } from 'fs';
import yargs from 'yargs';
import d3 from 'd3';
import vtm from 'd3-voronoi-treemap';

function computeCirclingPolygon(points, radius) {
  const increment = (2 * Math.PI) / points;
  const circlingPolygon = [];

  for (let a = 0, i = 0; i < points; i++, a += increment) {
    circlingPolygon.push([
      radius + radius * Math.cos(a),
      radius + radius * Math.sin(a),
    ]);
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

function deHierarchify(node) {
  const tmp = { ...node };
  tmp.children = 'elided';
  tmp.parent = 'elided';
  console.log(tmp);
  const children = node.children
    ? node.children.map((n) => deHierarchify(n))
    : undefined;
  return {
    name: node.data.name,
    children: children,
    polygon: node.polygon,
    value: node.value,
    data: node.data.data,
  };
}

async function main({ input, output }) {
  const rawData = await fs.readFile(input, 'utf-8');
  const width = 1024.0;
  const parsedData = JSON.parse(rawData);
  //   console.log(parsedData);
  console.log('building hierarchy');
  const rootNode = d3.hierarchy(parsedData).sum(flareWeightLoc);
  console.log('pruning empty nodes');
  pruneWeightlessNodes(rootNode);
  console.log('clipping and building mapper');
  const clipShape = computeCirclingPolygon(32, width / 2);

  const theMapper = vtm.voronoiTreemap().clip(clipShape);

  console.log('calculating voronoi treemap');
  theMapper(rootNode);
  console.log('converting');
  const results = deHierarchify(rootNode);

  console.log('saving');
  console.log(results);
  await fs.writeFile(output, JSON.stringify(results, null, 2));
  return 'OK';
}

const argv = yargs
  //   .usage('$0 -i [input]', 'add voronoi data to json input file')
  .usage('$0 [options]')
  .alias('i', 'input')
  .describe('i', 'Input JSON file')
  .alias('o', 'output')
  .describe('o', 'Output JSON file')
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
};

main(args).then(
  (result) => {
    console.error('done.', result);
  },
  (err) => {
    console.error('Error thrown!', err);
  }
);
