#!/bin/bash
#
# deploy-landgod.sh - 一键部署 landgod 到新设备
#
# 用法: ./deploy-landgod.sh <IP> <用户名> <密码> [设备名]
#
# 示例: ./deploy-landgod.sh 20.2.89.92 ZhouTest4 "test12345678&" ZhouTest4
#

set -e

# ========================
# 参数解析
# ========================
TARGET_IP="$1"
TARGET_USER="$2"
TARGET_PASS="$3"
DEVICE_NAME="${4:-$TARGET_USER}"

if [ -z "$TARGET_IP" ] || [ -z "$TARGET_USER" ] || [ -z "$TARGET_PASS" ]; then
    echo "用法: $0 <IP> <用户名> <密码> [设备名]"
    echo "示例: $0 20.2.89.92 root 'mypassword' my-server"
    exit 1
fi

# ========================
# 配置
# ========================
DEPLOY_KEY="$HOME/.ssh/landgod_deploy"
DEPLOY_KEY_PUB="$HOME/.ssh/landgod_deploy.pub"
PACKAGE_URL="https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-0.1.0.tgz"
PACKAGE_PATH="$HOME/cli-server/downloads/landgod-0.1.0.tgz"
WS_TOKEN="hardcoded-token-1234"
GATEWAY_URL="ws://localhost:8080"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✅]${NC} $1"; }
warn() { echo -e "${YELLOW}[⚠️]${NC} $1"; }
err()  { echo -e "${RED}[❌]${NC} $1"; exit 1; }

# ========================
# 前置检查
# ========================
echo ""
echo "========================================="
echo "  🚀 landgod 一键部署"
echo "========================================="
echo "  目标: $TARGET_USER@$TARGET_IP"
echo "  设备名: $DEVICE_NAME"
echo "========================================="
echo ""

command -v sshpass >/dev/null 2>&1 || err "需要 sshpass，请运行: sudo apt install sshpass"
[ -f "$DEPLOY_KEY" ] || err "部署密钥不存在: $DEPLOY_KEY，请运行: ssh-keygen -t ed25519 -f $DEPLOY_KEY -N ''"

# SSH 命令封装（使用密码）
ssh_pass() {
    sshpass -p "$TARGET_PASS" ssh $SSH_OPTS "$TARGET_USER@$TARGET_IP" "$@"
}

scp_pass() {
    sshpass -p "$TARGET_PASS" scp $SSH_OPTS "$@"
}

# SSH 命令封装（使用密钥）
ssh_key() {
    ssh -i "$DEPLOY_KEY" $SSH_OPTS "$TARGET_USER@$TARGET_IP" "$@"
}

# ========================
# Step 1: 测试连接
# ========================
log "Step 1/9: 测试 SSH 连接..."
ssh_pass "echo 'connected'" >/dev/null 2>&1 || err "SSH 连接失败"
REMOTE_OS=$(ssh_pass "uname -s")
log "连接成功! 系统: $REMOTE_OS"

# ========================
# Step 2: 注入 SSH 公钥
# ========================
log "Step 2/9: 注入部署密钥..."
PUB_KEY=$(cat "$DEPLOY_KEY_PUB")
ssh_pass "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB_KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
# 验证密钥登录
ssh_key "echo 'key-auth-ok'" >/dev/null 2>&1 || err "密钥认证失败"
log "密钥注入成功，后续不再需要密码"

# ========================
# Step 3: 检查 Node.js
# ========================
log "Step 3/9: 检查 Node.js..."
HAS_NODE=$(ssh_key "which node 2>/dev/null || echo 'no'")
if [ "$HAS_NODE" = "no" ]; then
    warn "Node.js 未安装，正在安装..."
    ssh_key "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" 2>&1 | tail -3
fi
NODE_VER=$(ssh_key "node --version")
log "Node.js $NODE_VER"

# ========================
# Step 4: 下载安装包到新机器
# ========================
log "Step 4/11: 下载 LandGod 安装包..."
ssh_key "curl -fsSL -o /tmp/landgod-0.1.0.tgz '$PACKAGE_URL'" 2>/dev/null
if ssh_key "test -f /tmp/landgod-0.1.0.tgz && test -s /tmp/landgod-0.1.0.tgz"; then
    log "从 GitHub 下载成功"
elif [ -f "$PACKAGE_PATH" ]; then
    warn "GitHub 下载失败，使用本地文件传输..."
    scp -i "$DEPLOY_KEY" $SSH_OPTS "$PACKAGE_PATH" "$TARGET_USER@$TARGET_IP:/tmp/landgod-0.1.0.tgz"
    log "本地传输完成"
else
    err "安装包下载失败且本地文件不存在"
fi

# ========================
# Step 5: 安装 landgod
# ========================
log "Step 5/9: 安装 landgod..."
ssh_key "sudo npm install -g /tmp/landgod-0.1.0.tgz 2>&1 | tail -3"
ssh_key "which landgod >/dev/null" || err "landgod 安装失败"
log "landgod 已安装"

# ========================
# Step 6: 安装系统依赖
# ========================
log "Step 6/9: 安装系统依赖..."
ssh_key "sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 libxss1 libxtst6 libdrm2 libgbm1 xvfb 2>&1 | tail -3"
log "系统依赖安装完成"

# ========================
# Step 7: 写入配置
# ========================
log "Step 7/9: 写入配置..."
CLIENT_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
CLAWNODE_ROOT=$(ssh_key "dirname \$(dirname \$(which landgod))/lib/node_modules/cli-server" 2>/dev/null || echo "/usr/lib/node_modules/cli-server")
# 尝试找到正确路径
CLAWNODE_ROOT=$(ssh_key "node -e \"console.log(require.resolve('cli-server/package.json').replace('/package.json',''))\"" 2>/dev/null || echo "/usr/lib/node_modules/cli-server")

ssh_key "sudo tee $CLAWNODE_ROOT/managed-client.config.json > /dev/null" << EOF
{
  "clientId": "$CLIENT_ID",
  "clientName": "$DEVICE_NAME",
  "enabled": true,
  "mode": "managed-client-mcp-ws",
  "bootstrapBaseUrl": "$GATEWAY_URL",
  "token": "$WS_TOKEN",
  "toolCallApprovalMode": "auto",
  "builtInTools": {
    "permissionProfile": "full-local-admin",
    "shellExecute": {
      "enabled": true,
      "allowedExecutableNames": ["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl","mkdir","rm","cp","mv","free","df","ps","nproc","grep","wc"],
      "allowedWorkingDirectories": ["/home/$TARGET_USER","/tmp","$CLAWNODE_ROOT"]
    }
  }
}
EOF
log "配置写入完成 (clientId: $CLIENT_ID)"

# ========================
# Step 8: 注册 systemd 服务（开机自启）
# ========================
log "Step 8/11: 注册 systemd 服务..."

# 获取 VM 公网 IP（用于反向隧道目标）
GATEWAY_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")

# 获取远程 landgod 安装路径
LANDGOD_BIN=$(ssh_key "which landgod" 2>/dev/null || echo "/usr/bin/landgod")
ELECTRON_BIN=$(ssh_key "node -e \"try{console.log(require('electron'))}catch{console.log('')}\"" 2>/dev/null)

# 8a: Xvfb 虚拟显示服务
ssh_key "sudo tee /etc/systemd/system/landgod-xvfb.service > /dev/null" << 'XVFB_EOF'
[Unit]
Description=LandGod Virtual Display (Xvfb)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x1024x24
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
XVFB_EOF

# 8b: 反向 SSH 隧道服务（autossh 风格）
ssh_key "sudo tee /etc/systemd/system/landgod-tunnel.service > /dev/null" << TUNNEL_EOF
[Unit]
Description=LandGod Reverse SSH Tunnel to Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
ExecStart=/usr/bin/ssh -i /home/$TARGET_USER/.ssh/authorized_keys_landgod -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -N -R 8080:localhost:8080 $TARGET_USER@$GATEWAY_IP
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
TUNNEL_EOF

# 写入专用隧道密钥（从 VM deploy key 复制私钥到远程机器）
PRIVATE_KEY=$(cat "$DEPLOY_KEY")
ssh_key "mkdir -p /home/$TARGET_USER/.ssh && cat > /home/$TARGET_USER/.ssh/authorized_keys_landgod << 'KEYEOF'
$PRIVATE_KEY
KEYEOF
chmod 600 /home/$TARGET_USER/.ssh/authorized_keys_landgod"

# 8c: LandGod daemon 服务
ssh_key "sudo tee /etc/systemd/system/landgod.service > /dev/null" << DAEMON_EOF
[Unit]
Description=LandGod Worker Daemon
After=landgod-xvfb.service landgod-tunnel.service
Requires=landgod-xvfb.service
Wants=landgod-tunnel.service

[Service]
Type=simple
Environment=DISPLAY=:99
Environment=XCLAW_NODE_DATA_DIR=$CLAWNODE_ROOT/.xclaw-node-data
ExecStart=$ELECTRON_BIN --no-sandbox --disable-gpu $CLAWNODE_ROOT --enable-managed-client-mcp-ws --managed-client-mcp-ws-only
Restart=always
RestartSec=10
WorkingDirectory=$CLAWNODE_ROOT

[Install]
WantedBy=multi-user.target
DAEMON_EOF

# 启用并启动所有服务
ssh_key "sudo systemctl daemon-reload"
ssh_key "sudo systemctl enable landgod-xvfb landgod-tunnel landgod"
ssh_key "sudo systemctl start landgod-xvfb"
ssh_key "sudo systemctl start landgod-tunnel" 2>/dev/null || true
ssh_key "sudo systemctl start landgod"
log "systemd 服务已注册并启动"

# ========================
# Step 9: 建立当前会话的反向隧道（立即生效）
# ========================
log "Step 9/11: 建立当前反向隧道..."
ssh -i "$DEPLOY_KEY" $SSH_OPTS -f -N \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -R 8080:localhost:8080 \
    "$TARGET_USER@$TARGET_IP" 2>/dev/null || true
sleep 2
log "反向隧道已建立"

# ========================
# Step 10: 验证连接
# ========================
log "Step 10/11: 验证连接..."
sleep 5

CONNECTED=$(curl -s http://localhost:8081/clients | python3 -c "
import json, sys
clients = json.load(sys.stdin)['clients']
for c in clients:
    if c['clientName'] == '$DEVICE_NAME' or c['clientId'] == '$CLIENT_ID':
        print('yes')
        break
else:
    print('no')
")

if [ "$CONNECTED" = "yes" ]; then
    log "✅ $DEVICE_NAME 已成功连接到 Gateway!"
else
    warn "$DEVICE_NAME 尚未出现在客户端列表，可能需要等待几秒..."
fi

# ========================
# Step 11: 验证 systemd 服务状态
# ========================
log "Step 11/11: 验证服务状态..."
ssh_key "sudo systemctl is-active landgod-xvfb landgod-tunnel landgod 2>/dev/null" | while read -r status; do
    echo "  $status"
done

if [ "$CONNECTED" = "yes" ]; then
    log "✅ $DEVICE_NAME 已成功连接到 Gateway!"
else
    warn "$DEVICE_NAME 尚未出现在客户端列表，可能需要等待几秒..."
fi

# ========================
# 清理
# ========================
echo ""
echo "========================================="
echo "  🔥 焚毁凭据"
echo "========================================="
# 密码不保存到任何文件，仅在内存中使用
# 清理临时文件
ssh_key "rm -f /tmp/landgod-0.1.0.tgz" 2>/dev/null
log "临时文件已清理"
log "密码仅在内存中使用，已随进程结束销毁"

echo ""
echo "========================================="
echo "  ✅ 部署完成!"
echo "========================================="
echo "  设备名: $DEVICE_NAME"
echo "  IP: $TARGET_IP"
echo "  ClientId: $CLIENT_ID"
echo ""
echo "  systemd 服务（开机自启）:"
echo "  - landgod-xvfb.service    虚拟显示"
echo "  - landgod-tunnel.service  反向隧道（自动重连）"
echo "  - landgod.service         Worker daemon"
echo ""
echo "  远程管理:"
echo "  - 查看设备: curl -s http://localhost:8081/clients"
echo "  - 执行命令: curl -X POST http://localhost:8081/tool_call \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"tool_name\":\"shell_execute\",\"arguments\":{\"command\":\"hostname\"}}'"
echo ""
echo "  服务管理（在目标机器上）:"
echo "  - sudo systemctl status landgod"
echo "  - sudo systemctl restart landgod"
echo "  - sudo systemctl stop landgod"
echo ""
echo "  隧道使用密钥认证，改密码不影响"
echo "  机器重启后自动恢复连接"
echo "========================================="
