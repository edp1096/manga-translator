#!/usr/bin/env bash
set -euo pipefail
# Never overwrite an already published release. Failed draft uploads can be retried.
if gh release view "$TAG" --json isDraft > release-state.json 2> release-error.txt; then
  if [[ "$(node -p 'JSON.parse(require("fs").readFileSync("release-state.json")).isDraft')" != true ]]; then
    echo "Release $TAG is already published; preserving its assets."
    exit 0
  fi
else
  # create --verify-tag fails safely for authentication/network failures or a missing tag.
  cat > release-notes.txt <<NOTES
Windows x64 / Linux x64 / Linux ARM64 portable packages.

Download the ZIP for your platform and extract it before running.
Models and runtimes are downloaded during application setup.
SHA256SUMS contains checksums for the packages and source archive.

Source commit: $SOURCE_COMMIT
NOTES
  gh release create "$TAG" --verify-tag --draft --title "$TAG" --notes-file release-notes.txt
fi
gh release upload "$TAG" dist/*.zip dist/*.tar.gz dist/*-SHA256SUMS.txt --clobber
gh release edit "$TAG" --draft=false
