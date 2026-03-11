#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNT="${1:-5}"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ]; then
  echo "Usage: $0 [N]  (number of parallel requests, default: 5)"
  exit 1
fi

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo "Firing $COUNT parallel requests..."
echo ""

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
WALL_START="$(now)"

for i in $(seq 1 "$COUNT"); do
  (
    curl --location 'http://localhost:3000/api/v1/render/batch?Content-Type=application/json' \
      --header 'Content-Type: application/json' \
      --header 'Authorization: Bearer dev-api-key' \
      --data-binary "@${SCRIPT_DIR}/single_request_body.json" \
      -s -o "$TMPDIR_BASE/body_$i" \
      -w '%{http_code} %{time_total} %{size_download}' \
      > "$TMPDIR_BASE/result_$i" 2>&1
  ) &
done

wait

WALL_END="$(now)"
WALL_TIME="$(echo "$WALL_END - $WALL_START" | bc)"

# Print results
printf "\n%-10s %-12s %-14s %-14s %-8s\n" "Request#" "Status" "Time (s)" "Size (bytes)" "Images"
printf "%-10s %-12s %-14s %-14s %-8s\n" "--------" "------" "--------" "------------" "------"

SUCCESS=0
FAIL=0
TIMES=()
TOTAL_IMAGES=0

for i in $(seq 1 "$COUNT"); do
  RESULT="$(cat "$TMPDIR_BASE/result_$i")"
  HTTP_CODE="$(echo "$RESULT" | awk '{print $1}')"
  TIME_TOTAL="$(echo "$RESULT" | awk '{print $2}')"
  SIZE="$(echo "$RESULT" | awk '{print $3}')"

  # Count images in batch response
  IMG_COUNT=0
  if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
    SUCCESS=$((SUCCESS + 1))
    STATUS_DISPLAY="$HTTP_CODE"
    if command -v jq &>/dev/null; then
      IMG_COUNT="$(jq '.results | length' "$TMPDIR_BASE/body_$i" 2>/dev/null || echo 0)"
    fi
  else
    FAIL=$((FAIL + 1))
    STATUS_DISPLAY="$HTTP_CODE FAIL"
  fi

  TOTAL_IMAGES=$((TOTAL_IMAGES + IMG_COUNT))
  TIMES+=("$TIME_TOTAL")
  printf "%-10s %-12s %-14s %-14s %-8s\n" "#$i" "$STATUS_DISPLAY" "$TIME_TOTAL" "$SIZE" "$IMG_COUNT"
done

# Compute min/avg/max
SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n))
MIN="${SORTED[0]}"
MAX="${SORTED[${#SORTED[@]}-1]}"
SUM="$(printf '%s+' "${TIMES[@]}" | sed 's/+$//' | bc)"
AVG="$(echo "scale=3; $SUM / $COUNT" | bc)"

echo ""
echo "=== Summary ==="
echo "Total requests:  $COUNT"
echo "Successes:       $SUCCESS"
echo "Failures:        $FAIL"
echo "Images generated: $TOTAL_IMAGES"
echo "Wall-clock time: ${WALL_TIME}s"
echo "Response times:  min=${MIN}s  avg=${AVG}s  max=${MAX}s"
