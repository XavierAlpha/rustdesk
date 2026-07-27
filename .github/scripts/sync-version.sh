#!/usr/bin/env bash
set -euo pipefail

version="${1:?version is required}"
build_number="${2:-0}"
source_date_epoch="${3:-}"
cargo_version="${version#v}"
app_version="${cargo_version}+${build_number}"
if [[ -n "$source_date_epoch" ]]; then
  build_date="$(
    python3 - "$source_date_epoch" <<'PY'
import datetime
import sys

timestamp = int(sys.argv[1])
print(datetime.datetime.fromtimestamp(timestamp, datetime.UTC).strftime("%Y-%m-%d %H:%M UTC"))
PY
  )"
else
  build_date="$(date -u '+%Y-%m-%d %H:%M UTC')"
fi

CARGO_VERSION="${cargo_version}" perl -0pi -e 's/^version = "[^"]+"/version = "$ENV{CARGO_VERSION}"/m' Cargo.toml

if [[ -f Cargo.lock ]]; then
  CARGO_VERSION="${cargo_version}" perl -0pi -e 's/(\[\[package\]\]\nname = "rustdesk"\nversion = ")[^"]+(")/$1$ENV{CARGO_VERSION}$2/' Cargo.lock
fi

APP_VERSION="${app_version}" perl -0pi -e 's/^version:.*/version: $ENV{APP_VERSION}/m' flutter/pubspec.yaml

mkdir -p src
cat > src/version.rs <<VERSION_RS
pub const VERSION: &str = "${cargo_version}";
#[allow(dead_code)]
pub const BUILD_DATE: &str = "${build_date}";
VERSION_RS
