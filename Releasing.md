# Releasing

Notes mostly for myself!

There are no packaged binaries or CI any more - this is run from source. A
"release" is just a tagged commit so the changelog has something to point at.

To release a new version:

* Check the changelog is up to date
* Update the version in package.json
* Run `npm test`
* commit and push

Then

```sh
git tag -a v0.6.2 -m "Releasing version v0.6.2"
git push --tags
```
