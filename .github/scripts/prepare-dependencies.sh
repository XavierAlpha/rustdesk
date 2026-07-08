#!/usr/bin/env bash
set -euo pipefail

mode="${1:-latest}"

case "${mode}" in
  latest)
    cargo update
    (cd flutter && flutter pub upgrade)
    if [[ -f flutter/web/js/package.json ]]; then
      (cd flutter/web/js && npm install)
    fi
    ;;
  locked)
    cargo fetch --locked
    (cd flutter && flutter pub get)
    if [[ -f flutter/web/js/package-lock.json ]]; then
      (cd flutter/web/js && npm ci)
    elif [[ -f flutter/web/js/package.json ]]; then
      (cd flutter/web/js && npm install)
    fi
    ;;
  *)
    echo "Unsupported dependency mode: ${mode}" >&2
    exit 2
    ;;
esac
