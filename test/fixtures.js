// Tiny hand-built trees in the scanner's input format. Kept small so the whole
// suite runs in a few seconds - voronoi simulation is the slow part.

const file = (name, loc) => ({ name, data: { loc: { code: loc } } });
const dir = (name, children) => ({ name, data: {}, children });
const repo = (name, children) => ({
  name,
  data: { git: { remote_url: `git@example.com:test/${name}.git`, head: 'deadbeef' } },
  children,
});

const wrap = (tree) => ({ version: '1.0.5', metadata: {}, tree });

// Five *identical* repos (1000 loc each, same file breakdown) sitting at depths
// 1 to 5, plus differently sized siblings so the enclosing directories actually
// have to grow. This is the core "does depth change the area:loc ratio" fixture.
const sameRepoAtEveryDepth = () => {
  const contents = () => [
    file('f0.rs', 400),
    file('f1.rs', 300),
    file('f2.rs', 150),
    file('f3.rs', 100),
    file('f4.rs', 50),
  ];
  return wrap(
    dir('<root>', [
      repo('r_depth1', contents()),
      dir('d1', [repo('r_depth2', contents()), repo('sibling2', [file('s.rs', 1000)])]),
      dir('e1', [
        dir('e2', [repo('r_depth3', contents()), repo('sib3', [file('s.rs', 2000)])]),
      ]),
      dir('f1', [
        dir('f2', [
          dir('f3', [repo('r_depth4', contents()), repo('sib4', [file('s.rs', 50)])]),
        ]),
      ]),
      dir('g1', [dir('g2', [dir('g3', [dir('g4', [repo('r_depth5', contents())])])])]),
    ])
  );
};

// All repos at the top level, so -c and -n should agree exactly.
const flatRepos = () =>
  wrap(
    dir('<root>', [
      repo('one', [file('a.rs', 700), file('b.rs', 300)]),
      repo('two', [file('a.rs', 2000)]),
      repo('three', [file('a.rs', 250), file('b.rs', 250)]),
    ])
  );

// The whole tree is itself a git repo (scanning a single checkout).
const treeRootIsRepo = () =>
  wrap(repo('<root>', [file('a.rs', 400), file('b.rs', 600)]));

// A repo vendored inside another repo, next to a plain nested control.
const repoInsideRepo = () =>
  wrap(
    dir('<root>', [
      repo('outer', [
        file('a.rs', 1000),
        file('b.rs', 2000),
        repo('vendored', [file('v1.rs', 500), file('v2.rs', 500)]),
      ]),
      dir('plain', [repo('control', [file('c.rs', 1000)])]),
    ])
  );

module.exports = {
  file,
  dir,
  repo,
  wrap,
  sameRepoAtEveryDepth,
  flatRepos,
  treeRootIsRepo,
  repoInsideRepo,
};
