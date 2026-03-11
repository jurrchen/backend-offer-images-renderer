#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Configuration ---
SERVER_URL="${RENDER_SERVER_URL:-http://localhost:3000}"
API_KEY="${RENDER_API_KEY:-dev-api-key}"

# --- Usage ---
usage() {
  echo "Usage: $0 <parallel> <slug1> [slug2] [slug3] ..."
  echo ""
  echo "  parallel   Number of concurrent requests (1 = sequential)"
  echo "  slug1..N   Product slugs to render"
  echo ""
  echo "Examples:"
  echo "  $0 1 stanley-stella-organic-cotton-t-shirt-dtg"
  echo "  $0 5 slug-one slug-two slug-three"
  echo ""
  echo "Environment variables:"
  echo "  RENDER_SERVER_URL  Server URL (default: $SERVER_URL)"
  echo "  RENDER_API_KEY     API key (default: dev-api-key)"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

PARALLEL="$1"
shift
SLUGS=("$@")

if ! [[ "$PARALLEL" =~ ^[0-9]+$ ]] || [ "$PARALLEL" -lt 1 ]; then
  echo "Error: parallel must be a positive number"
  exit 1
fi

# Extract base64 image from single_request_body.json
BODY_FILE="${SCRIPT_DIR}/single_request_body.json"
if [ ! -f "$BODY_FILE" ]; then
  echo "Error: $BODY_FILE not found"
  exit 1
fi

# Extract the images array from the body file (everything except productSlug)
IMAGE_DATA="$(jq -r '.images[0].data' "$BODY_FILE")"
if [ -z "$IMAGE_DATA" ] || [ "$IMAGE_DATA" = "null" ]; then
  echo "Error: Could not extract image data from $BODY_FILE"
  exit 1
fi

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

TOTAL=${#SLUGS[@]}
echo "Rendering $TOTAL slugs with parallelism=$PARALLEL"
echo "Server: $SERVER_URL"
echo ""

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
WALL_START="$(now)"

# Track results
RUNNING=0
IDX=0

run_slug() {
  local i="$1"
  local slug="$2"
  local body
  body=$(jq -n --arg slug "$slug" --arg img "$IMAGE_DATA" \
    '{ productSlug: $slug, images: [{ data: $img }] }')

  curl --location "${SERVER_URL}/api/v1/render/batch" \
    --header 'Content-Type: application/json' \
    --header "Authorization: Bearer ${API_KEY}" \
    --data "$body" \
    -s -o "$TMPDIR_BASE/body_$i" \
    -w '%{http_code} %{time_total} %{size_download}' \
    > "$TMPDIR_BASE/result_$i" 2>&1
}

# Launch slugs with parallelism limit
for slug in "${SLUGS[@]}"; do
  IDX=$((IDX + 1))

  run_slug "$IDX" "$slug" &
  RUNNING=$((RUNNING + 1))

  if [ "$RUNNING" -ge "$PARALLEL" ]; then
    wait -n 2>/dev/null || wait
    RUNNING=$((RUNNING - 1))
  fi
done

wait

WALL_END="$(now)"
WALL_TIME="$(echo "$WALL_END - $WALL_START" | bc)"

# Print results
printf "\n%-4s %-55s %-8s %-10s %-14s %-8s\n" "#" "Slug" "Status" "Time (s)" "Size (bytes)" "Images"
printf "%-4s %-55s %-8s %-10s %-14s %-8s\n" "---" "----" "------" "--------" "------------" "------"

SUCCESS=0
FAIL=0
TIMES=()
TOTAL_IMAGES=0

for i in $(seq 1 "$TOTAL"); do
  SLUG="${SLUGS[$((i - 1))]}"
  RESULT="$(cat "$TMPDIR_BASE/result_$i")"
  HTTP_CODE="$(echo "$RESULT" | awk '{print $1}')"
  TIME_TOTAL="$(echo "$RESULT" | awk '{print $2}')"
  SIZE="$(echo "$RESULT" | awk '{print $3}')"

  IMG_COUNT=0
  if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
    SUCCESS=$((SUCCESS + 1))
    STATUS_DISPLAY="$HTTP_CODE"
    if command -v jq &>/dev/null; then
      IMG_COUNT="$(jq '.results | length' "$TMPDIR_BASE/body_$i" 2>/dev/null || echo 0)"
    fi
  else
    FAIL=$((FAIL + 1))
    STATUS_DISPLAY="$HTTP_CODE !"
  fi

  TOTAL_IMAGES=$((TOTAL_IMAGES + IMG_COUNT))
  TIMES+=("$TIME_TOTAL")
  printf "%-4s %-55s %-8s %-10s %-14s %-8s\n" "$i" "$SLUG" "$STATUS_DISPLAY" "$TIME_TOTAL" "$SIZE" "$IMG_COUNT"
done

# Compute min/avg/max
SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n))
MIN="${SORTED[0]}"
MAX="${SORTED[${#SORTED[@]}-1]}"
SUM="$(printf '%s+' "${TIMES[@]}" | sed 's/+$//' | bc)"
AVG="$(echo "scale=3; $SUM / $TOTAL" | bc)"

echo ""
echo "=== Summary ==="
echo "Total slugs:      $TOTAL"
echo "Parallelism:      $PARALLEL"
echo "Successes:        $SUCCESS"
echo "Failures:         $FAIL"
echo "Images generated: $TOTAL_IMAGES"
echo "Wall-clock time:  ${WALL_TIME}s"
echo "Response times:   min=${MIN}s  avg=${AVG}s  max=${MAX}s"
