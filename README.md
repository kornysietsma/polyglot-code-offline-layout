# Polyglot code offline layout

This is a quite hacky script to calculate Voronoi Treemap layouts for JSON files produced by the polyglot-code-scanner program.

For an overview see <https://polyglot.korny.info>

For more detailed instructions on running this tool see <https://polyglot.korny.info/tools/layout/howto>

You run this script from source with node.js - see below.

## WORK IN PROGRESS WARNING

I'm doing a lot of changes right now - if you fetch the current code, things may break.

Especially note, I'm changed the data file formats created by the explorer and used by the scanner - I've added version number checks, but data files from the Scanner must match expectations of the Explorer, so for now it's a bit of "make sure you pull changes often" or things will break.


## Running this script

1. Install node.js - see https://nodejs.org/en/download/package-manager/
2. clone the code from https://github.com/kornysietsma/polyglot-code-offline-layout
3. In the checked out repository, run `npm install` to fetch all the dependencies

Then you can run it with

```sh
$ node layout.js -i input.json -o output.json
```

If you have multiple repositories in your source json, e.g. for a group of projects or microservices, you can ask for a pretty circle-packed algorithm for the main diagram with `-c`:

```sh
$ node layout.js -c -i input.json -o output.json
```

Or for hierarchical circle packing at every level (switching to voronoi at git repository roots), use `-n`:

```sh
$ node layout.js -n -i input.json -o output.json
```

The `-i` and `-o` parameters are optional, if you don't supply them the script will read stdin and send output to stdout, so you can use unix-style pipes, or :

```sh
$ node layout.js < input.json > output.json
```

There are some optional parameters:

- -h for help
- -c to use circle packing for the top level shaping, voronoi for the rest
- -n to use nested circle packing (circle packing at all levels except git repository roots, which use voronoi)
- -g (the default) to accept an imperfect voronoi map - if you turn this off, the script will fail if it can't find a precise layout
- -p NNN - specify how many points to use to draw the main circles around voronoi treemaps.  The default is 128, which is a pretty smooth circle.  You could specify `-p 6` and it will use hexagons!

## Testing

```sh
$ npm test
```

This runs `test/layout.test.js`, which builds small trees in memory, runs
`layout.js` in each mode, and checks the geometric invariants the layout relies
on - above all that a repository is drawn with an area proportional to its lines
of code, at the same ratio however deeply it is nested in the directory tree.
See `AGENTS.md` for the full list.
