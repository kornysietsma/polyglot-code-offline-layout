# Spec: Nested Circle Packing Until Git Repo Root

## Implementation Status: ✅ COMPLETED (2026-02-01)

**All 20 tests passing!**

The nested circle packing feature is fully implemented and working. Use `-n` / `--nested-circles` flag to enable.

### What Works

✅ **Git repository root detection** - Correctly identifies repo boundaries using `data.git.remote_url` / `data.git.head`  
✅ **Nested circle packing** - Recursively packs directories with circles until hitting git roots  
✅ **Voronoi at git roots** - Switches to voronoi layout for git repository contents  
✅ **Bottom-up packing** - Children packed first to determine actual radii before sibling packing  
✅ **Proper scaling** - Nodes scale up when needed to contain children; git roots maintain natural size  
✅ **Absolute coordinates** - All positions in root coordinate space for D3 visualization compatibility  
✅ **No overlaps** - Siblings properly spaced, children contained within parents  

### Key Bugs Fixed (2026-02-01)

1. **Coordinate system confusion** - Switched from relative to absolute coordinates throughout
2. **Packing order** - Now packs children first to get actual radii before packing siblings
3. **Enclosing radius calculation** - Fixed to account for parent constrained at origin
4. **Double scaling** - Removed incorrect multiplication of already-scaled radii
5. **Missing translation** - Added `translateSubtree()` to move children to absolute positions

See `agents.md` for detailed technical documentation and `spec_history.md` for implementation history.

---

## Next Steps: Comprehensive Test Suite

### Goals

Create a streamlined test suite that:
1. **Covers all 3 layout modes** (voronoi-only, top-level circles, nested circles)
2. **Uses simplified test data** - smaller input files for faster iteration
3. **Exercises edge cases** discovered during implementation
4. **Generates interesting visualizations** - enough variety to see all features

### Proposed Test Structure

**test-suite/**
- `test-all-layouts.js` - Run all layout modes and verify geometry
- `fixtures/` - Simplified test input files
  - `minimal.json` - Smallest possible tree (1 repo, 3 files)
  - `edge-cases.json` - Single-child nodes, empty dirs, deep nesting
  - `multi-repo.json` - Multiple git repos at different depths
  - `mixed-hierarchy.json` - Mix of voronoi and circle-packed sections

### Edge Cases to Test

Based on bugs discovered during implementation:

1. **Single-child containment** - Parent with 1 child should be concentric
2. **Deep nesting** - 5+ levels of directories before git root
3. **Sibling packing** - Multiple children with vastly different sizes
4. **Empty/tiny nodes** - Directories with minimal LOC that still need to contain children
5. **All git roots** - Tree where every directory is a git root
6. **No git roots** - Tree with no git data (circles all the way down)
7. **Mixed content** - Some directories with git roots, others without

### Test Data Generation

**Option A: Hand-craft minimal JSON**
```json
{
  "version": "1.0.0",
  "tree": {
    "name": "<root>",
    "value": 1000,
    "children": [
      {
        "name": "repo1",
        "value": 400,
        "data": {"git": {"remote_url": "...", "head": "..."}},
        "children": [...]
      },
      {
        "name": "dir1",
        "value": 600,
        "children": [...]
      }
    ]
  }
}
```

**Option B: Extract subset from manual-test-output.json**
- Start with working output
- Prune to interesting branches
- Maintain valid structure

**Recommendation: Option A** - Full control over edge cases, easier to reason about

### Test Implementation Plan

1. **Create fixture files** in `test-suite/fixtures/`
2. **Generate layouts** for each fixture with all 3 modes
3. **Verify geometry** using existing test patterns:
   - Containment (children within parents)
   - Scale factors (git roots = 1.0, others ≥ 1.0)
   - Sibling spacing (no overlaps)
4. **Visual verification** - Copy to polyglot-code-explorer and inspect
5. **Automate** - Run all tests with single command

### Success Criteria

- All geometry tests pass for all 3 layout modes
- Tests run in < 5 seconds total
- Visual output shows expected patterns
- Edge cases properly handled
- Tests serve as documentation of expected behavior

### Files to Create

- `test-suite/test-all-layouts.js` - Main test runner
- `test-suite/fixtures/minimal.json` - Simplest valid tree
- `test-suite/fixtures/edge-cases.json` - Problematic patterns
- `test-suite/fixtures/multi-repo.json` - Complex realistic example
- `test-suite/README.md` - Test documentation

**Status: NOT STARTED** - Documented for future implementation
