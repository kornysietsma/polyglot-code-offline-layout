# Polyglot code offline layout

This is a quite hacky script to calculate Voronoi Treemap layouts for JSON files produced by the polyglot-code-scanner program.

For an overview see <https://polyglot.korny.info>

For more detailed instructions on running this tool see <https://polyglot.korny.info/tools/layout/howto>

You can run this script using node.js, or via Docker - or binary builds are coming

## Running this script using node.js

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

The `-i` and `-o` parameters are optional, if you don't supply them the script will read stdin and send output to stdout, so you can use unix-style pipes, or :

```sh
$ node layout.js < input.json > output.json
```

If using Docker you _must_ do this, as Docker has been configured with no access to the file system, so it can't see your files.


There are some optional parameters:

- -h for help
- -c to use circle packing for the top level shaping, voronoi for the rest
- -g (the default) to accept an imperfect voronoi map - if you turn this off, the script will fail if it can't find a precise layout
- -p NNN - specify how many points to use to draw the main circles around voronoi treemaps.  The default is 128, which is a pretty smooth circle.  You could specify `-p 6` and it will use hexagons!


## Running this script using Docker

If you don't want node.js on your machine, but you have a Docker installation, this is probably cleaner.

* Check out this project to a local directory
* run `docker build -t polyglot:layout .` to fetch and build the docker dependencies
* then run:

```sh
docker run -a stdin -a stdout -a stderr -i --rm polyglot:layout node layout.js < input.json > output.json
```

You can add arguments after `layout.js` - sadly help and error messages from `yargs` sometimes go to stdout, so they will go in the `output.json` file in this case.

### What are those parameters?

* `-a stdin -a stdout -a stderr -i` mean the docker command runs like a script - stdin, stdout and stderr are all attached to the right things so file redirects work
* `--rm` removes the container when it's done - building it is very fast, this stops dead containers hanging around

### Why don't `-i` and `-o` work?

I've set up Docker so it doesn't mount the file system at all - this is much safer for everyone, there is no way for this process to modify files, and I don't need to worry about permissions or users (Docker by default runs as `root`! So a naive approach where I mount the file system and write to it, would mean the script could access the file system as root, not a good idea.)

But this means from the perspective of the script, it can't read or write to the file system at all.

## Binary executables

I am experimenting with using [pkg](https://www.npmjs.com/package/pkg) to package up runnable executables to make this simpler to use.

If you run `npm run-script build` it will build binaries for Windows, MacOS and Linux into a `dist` directory.  At some stage I plan to automate uploading these to Github releases - when I find the time!
