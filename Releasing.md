# Releasing

Notes mostly for myself!

To release a new version:

* Check the changelog is up to date
* Update the version in package.json
* commit and push

Then

```sh
git tag -a v0.6.2 -m "Releasing version v0.6.2"
git push --tags
```

Github actions should automatically build and publish new release artifacts.