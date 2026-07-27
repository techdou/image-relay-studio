#!/bin/bash
# Image Relay Studio API 测试脚本
#
# Usage:
#   export IRS_TEST_BASE_URL="https://your-host"
#   export IRS_TEST_API_KEY="irs_live_xxx"
#   bash scripts/test-api.sh
#
# 或通过 .env.local 加载（见 .env.example）。
# 切勿将真实 API Key 提交到版本库。

set -e

# Load .env.local if present (skip when CI sets vars explicitly).
if [[ -z "${IRS_TEST_BASE_URL:-}" || -z "${IRS_TEST_API_KEY:-}" ]] && [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

BASE_URL="${IRS_TEST_BASE_URL:?请设置 IRS_TEST_BASE_URL，例如 https://your-host}"
API_KEY="${IRS_TEST_API_KEY:?请设置 IRS_TEST_API_KEY，例如 irs_live_xxx}"
AUTH_HEADER="Authorization: Bearer ${API_KEY}"

PASS=0
FAIL=0

green() { echo -e "\033[32m$1\033[0m"; }
red()   { echo -e "\033[31m$1\033[0m"; }
cyan()  { echo -e "\033[36m$1\033[0m"; }
dim()   { echo -e "\033[2m$1\033[0m"; }

check() {
  local name="$1" status="$2" expected="$3"
  if [ "$status" -eq "$expected" ]; then
    green "  ✅ $name (HTTP $status)"
    PASS=$((PASS + 1))
  else
    red "  ❌ $name (expected $expected, got $status)"
    FAIL=$((FAIL + 1))
  fi
}

check_field() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    green "  ✅ $name = $actual"
    PASS=$((PASS + 1))
  else
    red "  ❌ $name (expected $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# ============================================================
echo ""
cyan "============================================================"
cyan "  Image Relay Studio — API 集成测试"
cyan "============================================================"
echo ""

# ----------------------------------------------------------
cyan "【1】健康检查 GET /api/health"
# ----------------------------------------------------------
RESP=$(curl -s --max-time 10 "${BASE_URL}/api/health")
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
HTTP_STATUS=$(echo "$RESP" | python3 -c "import sys,json; print('200')" 2>/dev/null || echo "000")

if echo "$RESP" | grep -q '"healthy"'; then
  green "  ✅ 服务健康"
  PASS=$((PASS + 1))
else
  red "  ❌ 服务不健康"
  FAIL=$((FAIL + 1))
fi

echo ""

# ----------------------------------------------------------
cyan "【2】模型列表 GET /api/v1/models"
# ----------------------------------------------------------
RESP=$(curl -s -w "\n%{http_code}" --max-time 10 -H "$AUTH_HEADER" "${BASE_URL}/api/v1/models")
HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

check "认证通过" "$HTTP_STATUS" "200"

# 提取第一个模型的 code
MODEL_CODE=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('data', [])
if models:
    print(models[0].get('code', ''))
else:
    print('')
" 2>/dev/null)

if [ -n "$MODEL_CODE" ]; then
  dim "  使用模型: $MODEL_CODE"
fi

echo ""

# ----------------------------------------------------------
cyan "【3】图像生成 POST /api/v1/images/generations"
# ----------------------------------------------------------
GENERATE_BODY=$(cat <<EOF
{
  "model": "${MODEL_CODE:-image-pro}",
  "prompt": "A modern building complex in a river valley, architectural details, photorealistic",
  "size": "2K",
  "n": 1,
  "visible_watermark": false,
  "idempotency_key": "test-$(date +%s)"
}
EOF
)

echo "  请求体:"
echo "$GENERATE_BODY" | python3 -m json.tool 2>/dev/null

RESP=$(curl -s -w "\n%{http_code}" --max-time 30 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "$GENERATE_BODY" \
  "${BASE_URL}/api/v1/images/generations")

HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "  响应:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 201 ]; then
  green "  ✅ 图像生成请求成功 (HTTP $HTTP_STATUS)"
  PASS=$((PASS + 1))
elif [ "$HTTP_STATUS" -eq 401 ]; then
  red "  ❌ 认证失败 — API Key 无效或已过期"
  FAIL=$((FAIL + 1))
elif [ "$HTTP_STATUS" -eq 429 ]; then
  red "  ⚠️  额度超限 (HTTP 429)"
  FAIL=$((FAIL + 1))
elif [ "$HTTP_STATUS" -eq 503 ]; then
  red "  ⚠️  生成服务已关闭 (HTTP 503)"
  FAIL=$((FAIL + 1))
else
  # 可能是额度不足、模型不可用等业务错误
  ERR_CODE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('code',''))" 2>/dev/null)
  ERR_MSG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message',''))" 2>/dev/null)
  red "  ❌ 请求失败 (HTTP $HTTP_STATUS): $ERR_CODE — $ERR_MSG"
  FAIL=$((FAIL + 1))
fi

# 提取 task_id
TASK_ID=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('data', {}).get('task_id', ''))
" 2>/dev/null)

echo ""
dim "  Task ID: ${TASK_ID:-无}"

echo ""

# ----------------------------------------------------------
cyan "【4】任务状态 GET /api/v1/tasks/{task_id}"
# ----------------------------------------------------------
if [ -n "$TASK_ID" ]; then
  RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
    -H "$AUTH_HEADER" \
    "${BASE_URL}/api/v1/tasks/${TASK_ID}")
  HTTP_STATUS=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  echo "  响应:"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

  check "任务查询" "$HTTP_STATUS" "200"

  TASK_STATUS=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('data', {}).get('status', ''))
" 2>/dev/null)
  dim "  任务状态: $TASK_STATUS"

  # 如果任务还在排队或运行中，轮询等待
  if [ "$TASK_STATUS" = "queued" ] || [ "$TASK_STATUS" = "running" ]; then
    echo ""
    cyan "  等待任务完成（最多 90 秒）..."
    for i in $(seq 1 18); do
      sleep 5
      RESP=$(curl -s --max-time 10 -H "$AUTH_HEADER" "${BASE_URL}/api/v1/tasks/${TASK_ID}")
      TASK_STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('status',''))" 2>/dev/null)
      echo "  [$((i*5))s] 状态: $TASK_STATUS"
      if [ "$TASK_STATUS" = "succeeded" ] || [ "$TASK_STATUS" = "failed" ] || [ "$TASK_STATUS" = "cancelled" ]; then
        break
      fi
    done
  fi

  if [ "$TASK_STATUS" = "succeeded" ]; then
    green "  ✅ 任务成功完成"
    PASS=$((PASS + 1))
  elif [ "$TASK_STATUS" = "failed" ]; then
    red "  ❌ 任务失败"
    FAIL=$((FAIL + 1))
  elif [ "$TASK_STATUS" = "cancelled" ]; then
    red "  ⚠️  任务已取消"
    FAIL=$((FAIL + 1))
  else
    dim "  ⏳ 任务状态: $TASK_STATUS（可能还在处理中）"
  fi
else
  dim "  跳过 — 未获取到 task_id"
fi

echo ""

# ----------------------------------------------------------
cyan "【5】图片列表 GET /api/v1/images"
# ----------------------------------------------------------
RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
  -H "$AUTH_HEADER" \
  "${BASE_URL}/api/v1/images?limit=5")
HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

check "图片列表" "$HTTP_STATUS" "200"

echo ""

# ----------------------------------------------------------
cyan "【6】使用量 GET /api/v1/usage"
# ----------------------------------------------------------
RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
  -H "$AUTH_HEADER" \
  "${BASE_URL}/api/v1/usage")
HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

check "使用量查询" "$HTTP_STATUS" "200"

echo ""

# ----------------------------------------------------------
cyan "【7】API Key 列表 GET /api/v1/api-keys"
# ----------------------------------------------------------
RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
  -H "$AUTH_HEADER" \
  "${BASE_URL}/api/v1/api-keys")
HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

check "API Key 列表" "$HTTP_STATUS" "200"

echo ""

# ----------------------------------------------------------
cyan "【8】无认证访问（应返回 401）"
# ----------------------------------------------------------
RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
  "${BASE_URL}/api/v1/models")
HTTP_STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

check "未认证访问拦截" "$HTTP_STATUS" "401"

echo ""

# ----------------------------------------------------------
cyan "【9】幂等性测试（重复 idempotency_key）"
# ----------------------------------------------------------
IDEM_KEY="idem-test-$(date +%s)"
GENERATE_BODY_2=$(cat <<EOF
{
  "model": "${MODEL_CODE:-image-pro}",
  "prompt": "Idempotency test: a red apple on a white table",
  "size": "2K",
  "n": 1,
  "idempotency_key": "${IDEM_KEY}"
}
EOF
)

RESP1=$(curl -s -w "\n%{http_code}" --max-time 15 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "$GENERATE_BODY_2" \
  "${BASE_URL}/api/v1/images/generations")
HTTP1=$(echo "$RESP1" | tail -1)
BODY1=$(echo "$RESP1" | sed '$d')
TASK1=$(echo "$BODY1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('task_id',''))" 2>/dev/null)

RESP2=$(curl -s -w "\n%{http_code}" --max-time 15 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "$GENERATE_BODY_2" \
  "${BASE_URL}/api/v1/images/generations")
HTTP2=$(echo "$RESP2" | tail -1)
BODY2=$(echo "$RESP2" | sed '$d')
TASK2=$(echo "$BODY2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('task_id',''))" 2>/dev/null)

if [ "$TASK1" = "$TASK2" ] && [ -n "$TASK1" ]; then
  green "  ✅ 幂等性校验通过 — 两次请求返回相同 task_id: $TASK1"
  PASS=$((PASS + 1))
else
  red "  ❌ 幂等性校验失败 — task1=$TASK1, task2=$TASK2"
  FAIL=$((FAIL + 1))
fi

echo ""

# ============================================================
cyan "============================================================"
echo ""
echo "  测试结果: $(green "通过 $PASS") / $(red "失败 $FAIL")"
echo ""
if [ "$FAIL" -eq 0 ]; then
  green "  全部通过 🎉"
else
  red "  存在失败项，请检查上方日志"
fi
echo ""
cyan "============================================================"
