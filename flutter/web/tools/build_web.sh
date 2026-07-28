#!/usr/bin/env bash

set -euo pipefail

MODE="${MODE:-release}"
RUN=false
SKIP_JS=false
SKIP_DEPS=false

usage() {
  cat <<'EOF'
Usage: build_web.sh [options]

Options:
  --mode release|profile|debug  Build mode (default: release)
  --run                         Run in Chrome instead of producing build/web
  --skip-js                     Reuse the existing compiled JS bridge
  --skip-deps                   Do not bootstrap optional codec assets
  -h, --help                    Show this help

The build never rewrites tracked launcher icons. Refresh those explicitly with
`flutter pub run flutter_launcher_icons` and review the generated source diff.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      if [[ $# -lt 2 ]]; then
        echo "--mode requires a value" >&2
        exit 1
      fi
      MODE="$2"
      shift 2
      ;;
    --run)
      RUN=true
      shift
      ;;
    --skip-js)
      SKIP_JS=true
      shift
      ;;
    --skip-deps)
      SKIP_DEPS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  release|profile|debug) ;;
  *)
    echo "Unsupported build mode: $MODE" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLUTTER_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$FLUTTER_ROOT"

FLUTTER="${FLUTTER_BIN:-flutter}"
if ! command -v -- "$FLUTTER" >/dev/null 2>&1; then
  echo "Missing '$FLUTTER'. Install Flutter and ensure it is in PATH, or set FLUTTER_BIN." >&2
  exit 1
fi

WEB_DIR="${FLUTTER_ROOT}/web"
WEB_JS_DIR="${WEB_DIR}/js"
WEB_JS_PKG="${WEB_JS_DIR}/package.json"
WEB_JS_LOCK="${WEB_JS_DIR}/package-lock.json"
REPO_ROOT="$(cd "${FLUTTER_ROOT}/.." && pwd)"
PUBSPEC_FILE="${FLUTTER_ROOT}/pubspec.yaml"
WEB_DEPS_URL="https://github.com/rustdesk/doc.rustdesk.com/releases/download/console/web_deps.tar.gz"
WEB_DEPS_SHA256="b66011c4fc066b90c46ba0c78884fe5d1a7e5a7fad3dce401300ad893de63818"
APP_VERSION_VALUE="${APP_VERSION:-}"
APP_NAME_VALUE="${APP_NAME:-}"
if [[ -z "$APP_VERSION_VALUE" && -f "$PUBSPEC_FILE" ]]; then
  APP_VERSION_VALUE="$(grep -E '^version:' "$PUBSPEC_FILE" | head -n 1 | sed -E 's/^version:[[:space:]]*//')"
fi

required_web_assets=(
  "index.html"
  "manifest.json"
  "favicon.svg"
  "favicon.png"
  "icons/Icon-192.png"
  "icons/Icon-512.png"
  "icons/Icon-maskable-192.png"
  "icons/Icon-maskable-512.png"
)
for required_asset in "${required_web_assets[@]}"; do
  if [[ ! -f "${WEB_DIR}/${required_asset}" ]]; then
    echo "Missing web asset: ${WEB_DIR}/${required_asset}" >&2
    exit 2
  fi
done

have_web_deps() {
  [[ -f "${WEB_DIR}/libopus.js" ]] &&
  [[ -f "${WEB_DIR}/libopus.wasm" ]] &&
  [[ -f "${WEB_DIR}/yuv-canvas-1.2.6.js" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-vp8-wasm.js" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-vp8-wasm.wasm" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-vp9-wasm.js" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-vp9-wasm.wasm" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-av1-wasm.js" ]] &&
  [[ -f "${WEB_DIR}/ogvjs-1.8.6/ogv-decoder-video-av1-wasm.wasm" ]]
}

if [[ "$SKIP_DEPS" == "false" ]]; then
  if have_web_deps; then
    echo "Web deps already present, skipping download."
  else
    DEPS_TAR="$(mktemp "${WEB_DIR}/.web-deps.XXXXXX.tar.gz")"
    trap 'rm -f -- "${DEPS_TAR:-}"' EXIT
    echo "Downloading web deps: $WEB_DEPS_URL"
    if command -v wget >/dev/null 2>&1; then
      wget -O "$DEPS_TAR" "$WEB_DEPS_URL"
    else
      curl --fail --location --retry 3 -o "$DEPS_TAR" "$WEB_DEPS_URL"
    fi

    if command -v sha256sum >/dev/null 2>&1; then
      actual_sha256="$(sha256sum "$DEPS_TAR" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      actual_sha256="$(shasum -a 256 "$DEPS_TAR" | awk '{print $1}')"
    else
      echo "Missing SHA-256 tool (sha256sum or shasum)." >&2
      exit 4
    fi
    if [[ "$actual_sha256" != "$WEB_DEPS_SHA256" ]]; then
      echo "Web deps checksum mismatch: expected $WEB_DEPS_SHA256, got $actual_sha256" >&2
      exit 4
    fi

    if ! tar -tzf "$DEPS_TAR" | awk '
      /^\// || /(^|\/)\.\.($|\/)/ { bad = 1 }
      !/^(ogvjs-1\.8\.6\/|libopus\.js$|libopus\.wasm$|yuv-canvas-1\.2\.6\.js$)/ { bad = 1 }
      END { exit bad }
    '; then
      echo "Web deps archive contains an unsafe or unexpected path." >&2
      exit 4
    fi
    if tar -tvzf "$DEPS_TAR" | awk '$1 ~ /^[lh]/ { found = 1 } END { exit !found }'; then
      echo "Web deps archive must not contain symbolic or hard links." >&2
      exit 4
    fi
    tar -xzf "$DEPS_TAR" -C "$WEB_DIR"
    rm -f "$DEPS_TAR"
    trap - EXIT
  fi
fi

"$FLUTTER" pub get --enforce-lockfile

if [[ "$SKIP_JS" == "false" ]]; then
  if [[ ! -f "$WEB_JS_PKG" ]]; then
    echo "Missing '$WEB_JS_PKG'. Add the web JS bridge toolchain, or use --skip-js." >&2
    exit 3
  fi
  if [[ ! -f "$WEB_JS_LOCK" ]]; then
    echo "Missing '$WEB_JS_LOCK'. Web builds require the committed npm lockfile." >&2
    exit 3
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Missing 'npm'. Install Node.js (npm) to build web JS dependencies." >&2
    exit 4
  fi
  pushd "$WEB_JS_DIR" >/dev/null
  npm ci --no-fund --no-audit
  npm run build
  popd >/dev/null
fi

if [[ ! -f "${WEB_JS_DIR}/dist/web_bridge.js" ]]; then
  echo "Missing compiled JS bridge: ${WEB_JS_DIR}/dist/web_bridge.js" >&2
  exit 3
fi

BUILD_DATE_VALUE="${BUILD_DATE:-}"
if [[ -z "$BUILD_DATE_VALUE" ]]; then
  SOURCE_DATE_EPOCH_VALUE="${SOURCE_DATE_EPOCH:-}"
  if [[ -z "$SOURCE_DATE_EPOCH_VALUE" ]]; then
    SOURCE_DATE_EPOCH_VALUE="$(git -C "$REPO_ROOT" show -s --format=%ct HEAD)"
  fi
  if [[ ! "$SOURCE_DATE_EPOCH_VALUE" =~ ^[0-9]+$ ]]; then
    echo "SOURCE_DATE_EPOCH must be a non-negative integer." >&2
    exit 4
  fi
  if BUILD_DATE_VALUE="$(date -u -d "@${SOURCE_DATE_EPOCH_VALUE}" '+%Y-%m-%d %H:%M UTC' 2>/dev/null)"; then
    :
  elif BUILD_DATE_VALUE="$(date -u -r "$SOURCE_DATE_EPOCH_VALUE" '+%Y-%m-%d %H:%M UTC' 2>/dev/null)"; then
    :
  else
    echo "Unable to convert SOURCE_DATE_EPOCH with the local date command." >&2
    exit 4
  fi
  export SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH_VALUE"
fi
if [[ "$BUILD_DATE_VALUE" == *$'\n'* || "$BUILD_DATE_VALUE" == *$'\r'* ]]; then
  echo "BUILD_DATE must be a single line." >&2
  exit 4
fi

is_set() {
  if [[ -n "${!1:-}" ]]; then
    printf 'set'
  else
    printf 'unset'
  fi
}

echo "Web build configuration: mode=$MODE run=$RUN version=${APP_VERSION_VALUE:-unset} build_date=$BUILD_DATE_VALUE"
echo "Endpoint configuration: RS_PUB_KEY=$(is_set RS_PUB_KEY) RENDEZVOUS_SERVERS=$(is_set RENDEZVOUS_SERVERS) API_SERVER=$(is_set API_SERVER) APP_NAME=$(is_set APP_NAME)"

FLUTTER_BUILD_ARGS=()
if [[ "$RUN" == "true" ]]; then
  FLUTTER_BUILD_ARGS=("run" "-d" "chrome" "-v")
  if [[ "$MODE" == "release" ]]; then
    FLUTTER_BUILD_ARGS+=("--release")
  elif [[ "$MODE" == "profile" ]]; then
    FLUTTER_BUILD_ARGS+=("--profile")
  fi
else
  FLUTTER_BUILD_ARGS=("build" "web" "--${MODE}" "--no-wasm-dry-run")
  if [[ "$MODE" == "release" ]]; then
    FLUTTER_BUILD_ARGS+=("--csp")
  fi
fi
if [[ -n "${RS_PUB_KEY:-}" ]]; then
  FLUTTER_BUILD_ARGS+=("--dart-define=RS_PUB_KEY=${RS_PUB_KEY}")
fi
if [[ -n "${RENDEZVOUS_SERVERS:-}" ]]; then
  FLUTTER_BUILD_ARGS+=("--dart-define=RENDEZVOUS_SERVERS=${RENDEZVOUS_SERVERS}")
fi
if [[ -n "${API_SERVER:-}" ]]; then
  FLUTTER_BUILD_ARGS+=("--dart-define=API_SERVER=${API_SERVER}")
fi
if [[ -n "$APP_NAME_VALUE" ]]; then
  FLUTTER_BUILD_ARGS+=("--dart-define=APP_NAME=${APP_NAME_VALUE}")
fi
if [[ -n "$APP_VERSION_VALUE" ]]; then
  FLUTTER_BUILD_ARGS+=("--dart-define=APP_VERSION=${APP_VERSION_VALUE}")
fi
FLUTTER_BUILD_ARGS+=("--dart-define=BUILD_DATE=${BUILD_DATE_VALUE}")

"$FLUTTER" "${FLUTTER_BUILD_ARGS[@]}"

if [[ "$RUN" == "false" ]]; then
  FLUTTER_BOOTSTRAP="${FLUTTER_ROOT}/build/web/flutter_bootstrap.js"
  if [[ ! -f "$FLUTTER_BOOTSTRAP" ]] ||
    ! grep -q '"compileTarget":"dart2js"' "$FLUTTER_BOOTSTRAP"; then
    echo "Incomplete Flutter web build configuration." >&2
    exit 5
  fi
  if grep -Eq '"builds":\[[^]]*(\{\},|,\{\})' "$FLUTTER_BOOTSTRAP"; then
    echo "Flutter web build contains an empty target configuration." >&2
    exit 6
  fi

  SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]]; then
    SOURCE_STATE="dirty"
  else
    SOURCE_STATE="clean"
  fi
  printf '%s %s\n' "$SOURCE_REVISION" "$SOURCE_STATE" > "${FLUTTER_ROOT}/build/web/.source_revision"
fi
