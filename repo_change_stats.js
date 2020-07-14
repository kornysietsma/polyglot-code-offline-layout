import { promises as fs, existsSync } from 'fs';
import yargs from 'yargs';
import moment from 'moment';

function accumulateDetails(yearMap, details) {
  details.forEach((detail) => {
    const year = moment.unix(detail.commit_day).year();
    const yearData = yearMap.get(year) || { commits: 0, lines: 0 };
    yearData.commits += detail.commits;
    yearData.lines += detail.lines_added + detail.lines_deleted;
    yearMap.set(year, yearData);
  });
}

function accumulateYearData(node, yearMap) {
  if (node.data && node.data.git && node.data.git.details) {
    accumulateDetails(yearMap, node.data.git.details);
  }
  if (node.children) {
    node.children.forEach((child) => {
      accumulateYearData(child, yearMap);
    });
  }
}

function yearData(repoName, node) {
  const yearMap = new Map();
  accumulateYearData(node, yearMap);
  return yearMap;
}

async function main({ input, output, points, circles }) {
  const rawData = await fs.readFile(input, 'utf-8');
  const parsedData = JSON.parse(rawData);
  // output is CSV for easy fiddling in excel
  console.log('repo, year, commits, lines');
  parsedData.children.forEach((child) => {
    if (child.children) {
      const repoName = child.name;
      const data = yearData(repoName, child);
      [...data.keys()].forEach((year) => {
        const yearData = data.get(year);
        console.log(
          `"${repoName}",${year},${yearData.commits},${yearData.lines}`
        );
      });
    }
  });
}

const argv = yargs
  //   .usage('$0 -i [input]', 'add voronoi data to json input file')
  .usage('$0 [options]')
  .alias('i', 'input')
  .describe('i', 'Input JSON file')
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
};

main(args).then(
  (result) => {
    console.error('done.', result);
  },
  (err) => {
    console.error('Error thrown!', err);
  }
);
