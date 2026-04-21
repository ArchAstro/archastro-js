#!/usr/bin/env bash
# Regenerate the TypeScript SDK from the canonical OpenAPI spec.
#
# Flow:
#   1. Fetch specs/platform-openapi.json from ArchAstro/archastro-openapi
#      on GitHub (the canonical source of truth).
#   2. Copy it into packages/sdk/specs/platform-openapi.json so the SDK
#      package ships its own copy for contract-test consumers.
#   3. Run @archastro/sdk-generator (from public npm via npx) to emit
#      TS resources, channel classes, and the contract-test tree under
#      packages/sdk/{src,__tests__/contract}.
#
# Usage:
#   ./scripts/regenerate_sdk.sh                       # pull spec from main
#   ./scripts/regenerate_sdk.sh --local /path/to/archastro-openapi
#   ARCHASTRO_OPENAPI_REF=some-branch ./scripts/regenerate_sdk.sh
#   ARCHASTRO_SDK_GENERATOR=@archastro/sdk-generator@0.1.0 ./scripts/regenerate_sdk.sh
#
# Args:
#   --local <path>            Path to a local archastro-openapi checkout.
#                             When set, the spec is copied from
#                             <path>/specs/platform-openapi.json instead
#                             of being fetched from GitHub. Mutually
#                             exclusive with ARCHASTRO_OPENAPI_REF.
#
# Env knobs:
#   ARCHASTRO_OPENAPI_REF     Git ref in archastro-openapi to pull the
#                             spec from (default: main). Useful when a
#                             spec change is on a branch awaiting merge.
#   ARCHASTRO_SDK_GENERATOR   Package spec for the generator passed to
#                             npx (default: @archastro/sdk-generator@latest).
#                             Pin to a specific version for reproducible
#                             regenerations in a release branch.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$REPO_ROOT/packages/sdk"
SPEC_DST="$SDK_DIR/specs/platform-openapi.json"
CONFIG_FILE="$REPO_ROOT/scripts/sdk-generator-config.json"

LOCAL_REPO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      if [[ $# -lt 2 ]]; then
        echo "--local requires a path argument" >&2
        exit 2
      fi
      LOCAL_REPO="$2"
      shift 2
      ;;
    --local=*)
      LOCAL_REPO="${1#--local=}"
      shift
      ;;
    -h|--help)
      sed -n 's/^# \{0,1\}//p' "$0" | sed -n '2,/^$/p'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

REF="${ARCHASTRO_OPENAPI_REF:-main}"
SPEC_URL="https://raw.githubusercontent.com/ArchAstro/archastro-openapi/${REF}/specs/platform-openapi.json"
SDK_GENERATOR_SPEC="${ARCHASTRO_SDK_GENERATOR:-@archastro/sdk-generator@latest}"

log() { printf '==> %s\n' "$*"; }

# ─── 1. Fetch the spec ──────────────────────────────────────────

mkdir -p "$(dirname "$SPEC_DST")"
if [[ -n "$LOCAL_REPO" ]]; then
  SPEC_SRC="$LOCAL_REPO/specs/platform-openapi.json"
  if [[ ! -f "$SPEC_SRC" ]]; then
    echo "spec not found at $SPEC_SRC" >&2
    exit 1
  fi
  log "Copying spec from $SPEC_SRC"
  cp "$SPEC_SRC" "$SPEC_DST"
else
  log "Fetching spec from $SPEC_URL"
  curl --fail --silent --show-error --location "$SPEC_URL" -o "$SPEC_DST"
fi

# Sanity-check the spec. Pass the path via env var rather than
# interpolating into the JS string so paths with quotes/spaces are safe.
SPEC="$SPEC_DST" node -e '
  const s = require(process.env.SPEC);
  const paths = Object.keys(s.paths ?? {}).length;
  const schemas = Object.keys(s.components?.schemas ?? {}).length;
  const channels = (s["x-channels"] ?? []).length;
  console.log(`Spec: ${paths} routes, ${schemas} schemas, ${channels} channels`);
'

# ─── 2. Generate SDK + contract tests ───────────────────────────

log "Generating TypeScript SDK into $SDK_DIR"
npx --yes "$SDK_GENERATOR_SPEC" \
  --spec "$SPEC_DST" \
  --config "$CONFIG_FILE" \
  --lang typescript \
  --out "$SDK_DIR"

log "Generating TypeScript contract tests into $SDK_DIR"
npx --yes "$SDK_GENERATOR_SPEC" \
  --spec "$SPEC_DST" \
  --config "$CONFIG_FILE" \
  --lang contract-tests-ts \
  --out "$SDK_DIR"

log "Done. Review the diff and commit, or re-run this script after the spec is updated upstream."
