#!/usr/bin/env bash
# doctor.sh — checks and optionally installs argus-qa dependencies
# Usage: bash doctor.sh check
#        bash doctor.sh install <tool>  (jq | playwright | browsers | gitignore)

set -e
CMD="${1:-check}"
TOOL="${2:-}"

check_tool() {
  local name="$1" cmd="$2"
  if command -v "$cmd" &>/dev/null; then
    printf '  ✓ %-20s %s\n' "$name" "$($cmd --version 2>&1 | head -1)"
  else
    printf '  ✗ %-20s NOT FOUND\n' "$name"
    echo "    Install: $(install_hint "$name")"
    return 1
  fi
}

check_node() {
  if command -v node &>/dev/null; then
    local v; v=$(node --version | sed 's/v//')
    local major; major=$(echo "$v" | cut -d. -f1)
    if [ "$major" -ge 18 ]; then
      printf '  ✓ %-20s v%s\n' "node" "$v"
    else
      printf '  ✗ %-20s v%s (need 18+)\n' "node" "$v"
      echo "    Install: Visit https://nodejs.org and download LTS"
      return 1
    fi
  else
    printf '  ✗ %-20s NOT FOUND\n' "node"
    echo "    Install: Visit https://nodejs.org and download LTS"
    return 1
  fi
}

check_playwright() {
  if npx --no playwright --version &>/dev/null 2>&1; then
    printf '  ✓ %-20s %s\n' "playwright" "$(npx --no playwright --version 2>&1)"
  else
    printf '  ✗ %-20s NOT FOUND\n' "playwright"
    echo "    Install: npm install -D @playwright/test"
    return 1
  fi
}

install_hint() {
  local os; os="$(uname -s 2>/dev/null || echo Windows)"
  case "$1" in
    jq)
      case "$os" in
        Darwin) echo "brew install jq" ;;
        Linux) echo "apt install jq  OR  dnf install jq" ;;
        *) echo "winget install jqlang.jq" ;;
      esac ;;
    curl) echo "should be pre-installed; check your OS packages" ;;
    git)  echo "https://git-scm.com/downloads" ;;
    *) echo "see https://nodejs.org" ;;
  esac
}

if [ "$CMD" = "check" ]; then
  echo ""
  echo "  argus-qa dependency check"
  echo "  ─────────────────────────"
  FAILED=0
  check_node       || FAILED=1
  check_tool "jq"   "jq"   || FAILED=1
  check_tool "curl" "curl" || FAILED=1
  check_tool "awk"  "awk"  || FAILED=1
  check_playwright         || FAILED=1
  echo ""
  [ $FAILED -eq 0 ] && echo "  ✓ All checks passed" || echo "  ✗ Some checks failed — see above"
  exit $FAILED
fi

if [ "$CMD" = "install" ]; then
  case "$TOOL" in
    jq)
      OS="$(uname -s 2>/dev/null || echo Windows)"
      case "$OS" in
        Darwin)  brew install jq ;;
        Linux)   apt-get install -y jq 2>/dev/null || dnf install -y jq ;;
        *)       winget install jqlang.jq ;;
      esac ;;
    playwright)
      npm install -D @playwright/test ;;
    browsers)
      npx playwright install chromium firefox webkit ;;
    gitignore)
      { echo ""; echo ".claude/secrets.json"; echo ".tmp/"; } >> .gitignore
      echo "  ✓ Added .claude/secrets.json and .tmp/ to .gitignore" ;;
    *)
      echo "Unknown tool: $TOOL" >&2; exit 1 ;;
  esac
fi


