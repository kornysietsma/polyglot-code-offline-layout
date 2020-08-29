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

## Binary executables

If you don't want to install node.js, you can fetch a bundled executable file instead.

I am using [pkg](https://www.npmjs.com/package/pkg) to package up runnable executables.

### Fetching binary releases

Binary releases are published to <https://github.com/kornysietsma/polyglot-code-offline-layout/releases>

You should be able to download the right file for your platform here.  Note I haven't tested this at all on Windows yet!  And I only have a single generic build for linux and OSX - if you are on another platform, you'll have to use node.js for now.

### Getting binaries to work on mac OSX

OSX has a system to protect you from malware, called 'gatekeeper' - by default on OSX if you try to run the binary app, you'll get an error "app is from an unknown developer".  To bypass this I'd have to go through a complex extra stage of signing and bundling my tool as an application, which I'm avoiding for now.

If you are happy that the binary is safe - all the code that builds it is on github, so you should be able to inspect it yourself - you can run it by stripping the extra attributes that OSX adds when you download it:

```sh
unzip polyglot-code-offline-layout-macos.zip
xattr -d com.apple.quarantine polyglot-code-offline-layout
```

Then you can move the `polyglot-code-offline-layout` binary to wherever you want.
