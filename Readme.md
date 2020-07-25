# Polyglot code offline layout

This is a quite hacky script to calculate Voronoi Treemap layouts for JSON files produced by the polyglot-code-scanner program.

This runs as a node.js script offline, rather than in a browser, as the algorithm is far too slow to run in a browser as it is - especially with retries!

This does limit the polyglot-code-explorer to use fixed layouts - some time it'd be nice to build a layout engine fast enough for a browser, but that's a lot of work.

Also, I'm using the really nice libraries by LeBeau Franck - [d3-voronoi-treemap](https://github.com/Kcnarf/d3-voronoi-treemap), [d3-voronoi-map](https://github.com/Kcnarf/d3-voronoi-map) and [d3-weighted-voronoi](https://github.com/Kcnarf/d3-weighted-voronoi) - but I've had to do some extra ugliness, as these libraries sometimes throw exceptions, and sometimes fail to converge, and generally are a bit unreliable in some situations.

As I'm very time-limited and the algorithms here are cool but complex, for now I just run the whole voronoi simulation in a loop.

For a given layout, I initialise a simulation (which gives a random position) and run it.

If an exception is thrown, I ignore it and re-run the simulation with a new random start point.

If a simulation doesn't get to the desired threshold fast enough, I record how "good" the simulation result was, and re-run the simulation with a new random start point.

If I get to the point where I've run 200 simulations and still not found a good result, then I just use the best one seen so far.

