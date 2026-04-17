#!/usr/bin/env bash
# Regenerate the TypeScript SDK from the canonical OpenAPI spec.
#
# Flow:
#   1. Fetch the Platform OpenAPI spec from the archastro-openapi repo
#      (canonical source of truth). Override with $ARCHASTRO_OPENAPI_LOCAL
#      to point at a local checkout while iterating on the spec.
#   2. Copy it into packages/sdk/specs/platform-openapi.json so the SDK
#      package ships its own copy for contract-test consumers.
#   3. Run @archastro/sdk-generator against the spec, emitting TS
#      resources, channel classes, and the contract-test tree under
#      packages/sdk/{src,__tests__/contract}.
#
# Usage:
#   ./scripts/regenerate_sdk.sh                       # pull from GitHub main
#   ARCHASTRO_OPENAPI_REF=some-branch ./scripts/regenerate_sdk.sh
#   ARCHASTRO_OPENAPI_LOCAL=~/archastro/archastro-openapi ./scripts/regenerate_sdk.sh
#
# Env knobs:
#   ARCHASTRO_OPENAPI_LOCAL   Path to a local archastro-openapi checkout.
#                             Bypasses the GitHub fetch and uses the local
#                             sdk-generator build instead of npx.
#   ARCHASTRO_OPENAPI_REF     Git ref (default: main) to pull the spec
#                             from when no local checkout is configured.
#   ARCHASTRO_SDK_GENERATOR   Override the sdk-generator package spec
#                             passed to npx (default: @archastro/sdk-generator@latest).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$REPO_ROOT/packages/sdk"
SPEC_DST="$SDK_DIR/specs/platform-openapi.json"
CONFIG_FILE="$REPO_ROOT/scripts/sdk-generator-config.json"

REF="${ARCHASTRO_OPENAPI_REF:-main}"
SPEC_URL="https://raw.githubusercontent.com/ArchAstro/archastro-openapi/${REF}/specs/platform-openapi.json"
SDK_GENERATOR_SPEC="${ARCHASTRO_SDK_GENERATOR:-@archastro/sdk-generator@latest}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ─── 1. Resolve the spec ────────────────────────────────────────

mkdir -p "$(dirname "$SPEC_DST")"

if [[ -n "${ARCHASTRO_OPENAPI_LOCAL:-}" ]]; then
  SPEC_SRC="${ARCHASTRO_OPENAPI_LOCAL%/}/specs/platform-openapi.json"
  [[ -f "$SPEC_SRC" ]] || die "local spec not found at $SPEC_SRC"
  log "Using local spec from $ARCHASTRO_OPENAPI_LOCAL (ref: working tree)"
  cp "$SPEC_SRC" "$SPEC_DST"
else
  log "Fetching spec from $SPEC_URL"
  curl --fail --silent --show-error --location "$SPEC_URL" -o "$SPEC_DST"
fi

# Sanity-check the spec before handing it to the generator.
paths=$(node -e "const s=require('$SPEC_DST');console.log(Object.keys(s.paths||{}).length)")
schemas=$(node -e "const s=require('$SPEC_DST');console.log(Object.keys(s.components?.schemas||{}).length)")
channels=$(node -e "const s=require('$SPEC_DST');console.log((s['x-channels']||[]).length)")
log "Spec: $paths routes, $schemas schemas, $channels channels"

# ─── 2. Choose the generator ────────────────────────────────────

if [[ -n "${ARCHASTRO_OPENAPI_LOCAL:-}" ]]; then
  LOCAL_GEN="${ARCHASTRO_OPENAPI_LOCAL%/}/packages/sdk-generator/dist/index.js"
  if [[ ! -f "$LOCAL_GEN" ]]; then
    log "Local generator dist missing — building it"
    (cd "${ARCHASTRO_OPENAPI_LOCAL%/}/packages/sdk-generator" && npx tsc)
  fi
  GEN_CMD=(node "$LOCAL_GEN")
else
  GEN_CMD=(npx --yes "$SDK_GENERATOR_SPEC")
fi

# ─── 3. Generate SDK + contract tests ───────────────────────────

log "Generating TypeScript SDK into $SDK_DIR"
"${GEN_CMD[@]}" \
  --spec "$SPEC_DST" \
  --config "$CONFIG_FILE" \
  --lang typescript \
  --out "$SDK_DIR"

log "Generating TypeScript contract tests into $SDK_DIR"
"${GEN_CMD[@]}" \
  --spec "$SPEC_DST" \
  --config "$CONFIG_FILE" \
  --lang contract-tests-ts \
  --out "$SDK_DIR"

log "Done. Review the diff and commit, or re-run this script after the spec is updated upstream."
