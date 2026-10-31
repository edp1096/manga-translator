Rebuild the committed extension/polygon.js:
  npm ci --ignore-scripts --prefix control/tools/geometry
  npm run build --prefix control/tools/geometry
Clipper2-ts is pinned and bundled locally. No CDN, runtime npm, or network import.
The generated file and the Boost license are shipped in the extension.
