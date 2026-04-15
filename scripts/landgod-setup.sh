#!/bin/bash
set -e

AppName="XLandGod"
RootDir="$(cd "$(dirname "$0")/.." && pwd)"
DistDir="$RootDir/dist"

# 输出初始化信息
function write_header {
  echo "========================================"
  printf "  %s Onboarding\n" "$AppName"
  echo "========================================"
}

# 检查命令是否存在
function test_command_exists {
  if ! command -v "$1" &> /dev/null; then
    printf "ERROR: Command '%s' is required but not found.\n" "$1"
    exit 1
  fi
}

# 显示 Yes/No 提示
function read_yes_no {
  local prompt="$1"
  local default_yes=$2
  local input
  local default_text=$( [ "$default_yes" = true ] && echo "Y/n" || echo "y/N" )
  while true; do
    read -p "$prompt [$default_text]: " input
    input=$(echo "$input" | tr '[:upper:]' '[:lower:]')
    if [ -z "$input" ]; then
      [ "$default_yes" = true ] && return 0 || return 1
    elif [[ "$input" =~ ^(y|yes)$ ]]; then
      return 0
    elif [[ "$input" =~ ^(n|no)$ ]]; then
      return 1
    else
      echo "Invalid input. Please answer 'yes' or 'no'."
    fi
  done
}

# 模式选择菜单 (增强视觉体验)
function select_mode {
  echo -e "\nChoose startup mode:"
  echo "  1) Head UI (Managed MCP WS)"
  echo "  2) Headless (Managed MCP WS)"
  echo ""
  while true; do
    read -p "Select [1-2]: " option
    case "$option" in
      1) echo "head-ui-ws"; return ;;
      2) echo "headless-ws"; return ;;
      *) echo "Invalid input. Please select 1 or 2." ;;
    esac
  done
}

# 打包构建分发包
function build_bundle {
  echo "INFO: Generating application package..."
  pushd "$RootDir" > /dev/null
  if ! npm run make > /dev/null 2>&1; then
    echo "ERROR: Build failed during 'make'!"
    exit 1
  fi

  mkdir -p "$DistDir"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local zip_path="$DistDir/$AppName-$timestamp.zip"
  local make_path="$RootDir/out/make"

  if [ ! -d "$make_path" ]; then
    echo "ERROR: Build output directory not found: $make_path"
    exit 1
  fi

  echo "INFO: Compressing build to $zip_path ..."
  if ! zip -r "$zip_path" "$make_path"/* > /dev/null; then
    echo "ERROR: Compression failed!"
    exit 1
  fi

  echo "Bundle created successfully: $zip_path"
  popd > /dev/null
}

# 主脚本
write_header
test_command_exists "npm"

# 安装依赖
if read_yes_no "Install dependencies now?" true; then
  echo "INFO: Installing dependencies, please wait..."
  pushd "$RootDir" > /dev/null
  if ! npm install --no-audit > /dev/null 2>&1; then
    echo "ERROR: Failed to install dependencies. Check npm logs for details."
    exit 1
  fi
  echo "INFO: Dependencies installed successfully."
  popd > /dev/null
fi

# 菜单选择模式
mode=$(select_mode)
echo "INFO: You have selected mode: '$mode'."

# 配置 Base URL 和 Token
echo ""
read -p "Enter Managed MCP Base URL (e.g., ws://localhost:8000/api/mcphub/ws): " base_url
read -p "Enter Managed MCP Bearer Token (optional): " token

export MANAGED_CLIENT_BASE_URL="$base_url"
export MANAGED_CLIENT_BEARER_TOKEN="$token"

if [ "$mode" == "head-ui-ws" ] && [ -n "$token" ]; then
  echo "INFO: Static token detected. Switching to 'headless' mode (No UI required)."
  mode="headless-ws"
fi

# 构建分发包
if read_yes_no "Build a distributable package now?" true; then
  build_bundle
fi

# 启动应用程序
echo "INFO: Launching application ($mode mode)..."
pushd "$RootDir" > /dev/null
case "$mode" in
  "head-ui-ws") npm run start:managed-client-mcp-ws-ui ;;
  "headless-ws") npm run start:managed-client-mcp-ws ;;
esac
popd > /dev/null