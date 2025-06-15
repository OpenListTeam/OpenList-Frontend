# OpenList (frontend)

![License MIT](https://img.shields.io/badge/license-MIT-green)
[![GitHub package.json version](https://img.shields.io/github/package-json/v/OpenListTeam/OpenList-Frontend)](./package.json)
[![NPM Version](https://img.shields.io/npm/v/%40openlist-frontend%2Fopenlist-frontend)](https://www.npmjs.com/package/@openlist-frontend/openlist-frontend)
[![NPM Downloads](https://img.shields.io/npm/dw/%40openlist-frontend%2Fopenlist-frontend)](https://www.npmjs.com/package/@openlist-frontend/openlist-frontend)
[![NPM Last Update](https://img.shields.io/npm/last-update/%40openlist-frontend%2Fopenlist-frontend)](https://www.npmjs.com/package/@openlist-frontend/openlist-frontend)

## BUILD

You can use [the build script](./build.sh).

```plaintext
Usage: ./build.sh [--dev|--release] [--compress|--no-compress] [--enforce-tag]

Options (will overwrite environment setting):
  --dev         Build development version
  --release     Build release version (will check if git tag match package.json version)
  --compress    Create compressed archive
  --no-compress Skip compression
  --enforce-tag Force git tag requirement for both dev and release builds

Environment variables:
  OPENLIST_FRONTEND_BUILD_MODE=dev|release (default: dev)
  OPENLIST_FRONTEND_BUILD_COMPRESS=true|false (default: false)
  OPENLIST_FRONTEND_BUILD_ENFORCE_TAG=true|false (default: false)
```

## LICENSE

MIT

## CREDITS

[OpenList](https://github.com/OpenListTeam/OpenList) is a resilient, community-driven fork of [AList](https://github.com/AlistGo/alist) — built to defend open source against trust-based attacks.
