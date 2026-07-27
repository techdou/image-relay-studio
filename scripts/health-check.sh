#!/usr/bin/env bash
# Health Check Script
# Checks the health of all system components

set -euo pipefail

PORT="${DEPLOY_RUN_PORT:-5000}"
BASE_URL="http://localhost:${PORT}"

echo "=== Image Relay Studio Health Check ==="
echo ""

# Check application
echo -n "Application: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ OK (HTTP 200)"
else
  echo "✗ FAIL (HTTP ${HTTP_CODE})"
fi

# Detailed health
echo ""
echo "Detailed status:"
curl -s "${BASE_URL}/api/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Unable to get detailed status"

echo ""
echo "=== Health Check Complete ==="
