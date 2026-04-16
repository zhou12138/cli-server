#
# landgod-deploy.ps1 - Windows 一键远程部署 LandGod Worker
#
# 用法: .\landgod-deploy.ps1 -IP <IP> -User <用户名> -Pass <密码> [-Name <设备名>]
#
# 示例: .\landgod-deploy.ps1 -IP 20.2.89.92 -User ZhouTest4 -Pass "test12345678&" -Name ZhouTest4
#

param(
    [Parameter(Mandatory = $true)][string]$IP,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Pass,
    [string]$Name = $User
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ========================
# 配置
# ========================
$DeployKey = "$HOME\.ssh\landgod_deploy"
$DeployKeyPub = "$HOME\.ssh\landgod_deploy.pub"
$PackagePath = Join-Path $PSScriptRoot '..\landgod-0.1.0.tgz'
$WsToken = 'hardcoded-token-1234'
$GatewayUrl = 'ws://localhost:8080'

# ========================
# 工具函数
# ========================
function Log { param([string]$Msg) Write-Host "[✅] $Msg" -ForegroundColor Green }
function Warn { param([string]$Msg) Write-Host "[⚠️] $Msg" -ForegroundColor Yellow }
function Err { param([string]$Msg) Write-Host "[❌] $Msg" -ForegroundColor Red; exit 1 }

function Invoke-SSH {
    param([string]$Command)
    $result = & plink.exe -batch -pw $Pass "$User@$IP" $Command 2>&1
    return $result
}

function Invoke-SSHKey {
    param([string]$Command)
    $result = & plink.exe -batch -i $DeployKey "$User@$IP" $Command 2>&1
    return $result
}

# ========================
# 主流程
# ========================
Write-Host ''
Write-Host '========================================='
Write-Host '  🚀 LandGod 一键部署 (Windows)'
Write-Host '========================================='
Write-Host "  目标: $User@$IP"
Write-Host "  设备名: $Name"
Write-Host '========================================='
Write-Host ''

# 检查前置条件
if (-not (Get-Command plink.exe -ErrorAction SilentlyContinue)) {
    Err "需要 plink.exe (PuTTY)，请安装: https://www.putty.org/"
}
if (-not (Test-Path $PackagePath)) {
    Err "安装包不存在: $PackagePath"
}

# Step 1: 测试连接
Log 'Step 1/9: 测试 SSH 连接...'
$testResult = Invoke-SSH 'echo connected'
if ($testResult -notmatch 'connected') { Err 'SSH 连接失败' }
Log '连接成功!'

# Step 2: 注入 SSH 公钥
Log 'Step 2/9: 注入部署密钥...'
if (-not (Test-Path $DeployKeyPub)) {
    Log '生成部署密钥对...'
    ssh-keygen -t ed25519 -f $DeployKey -N '""' -C 'landgod-deploy'
}
$pubKey = Get-Content $DeployKeyPub -Raw
Invoke-SSH "mkdir -p ~/.ssh && echo '$pubKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
Log '密钥注入成功'

# Step 3: 检查 Node.js
Log 'Step 3/9: 检查 Node.js...'
$nodeCheck = Invoke-SSH 'node --version 2>/dev/null || echo no-node'
if ($nodeCheck -match 'no-node') {
    Warn 'Node.js 未安装，正在安装...'
    Invoke-SSH "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
}
Log "Node.js 已就绪"

# Step 4: 传输安装包
Log 'Step 4/9: 传输安装包...'
& pscp.exe -pw $Pass $PackagePath "${User}@${IP}:/tmp/landgod-0.1.0.tgz"
Log '传输完成'

# Step 5: 安装 LandGod
Log 'Step 5/9: 安装 LandGod...'
Invoke-SSH 'sudo npm install -g /tmp/landgod-0.1.0.tgz'
Log 'LandGod 已安装'

# Step 6: 安装系统依赖
Log 'Step 6/9: 安装系统依赖...'
Invoke-SSH 'sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 libxss1 libxtst6 libdrm2 libgbm1 xvfb'
Log '系统依赖安装完成'

# Step 7: 写入配置
Log 'Step 7/9: 写入配置...'
$clientId = [guid]::NewGuid().ToString()
$configJson = @"
{
  "clientId": "$clientId",
  "clientName": "$Name",
  "enabled": true,
  "mode": "managed-client-mcp-ws",
  "bootstrapBaseUrl": "$GatewayUrl",
  "token": "$WsToken",
  "toolCallApprovalMode": "auto",
  "builtInTools": {
    "permissionProfile": "full-local-admin",
    "shellExecute": {
      "enabled": true,
      "allowedExecutableNames": ["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl"],
      "allowedWorkingDirectories": ["/home/$User","/tmp"]
    }
  }
}
"@
Invoke-SSH "sudo tee /usr/lib/node_modules/landgod/managed-client.config.json > /dev/null << 'EOF'
$configJson
EOF"
Log "配置写入完成 (clientId: $clientId)"

# Step 8: 建立反向隧道 + 启动 daemon
Log 'Step 8/9: 建立反向隧道 + 启动 daemon...'
Invoke-SSH 'nohup Xvfb :99 -screen 0 1280x1024x24 &>/dev/null &'
Start-Process plink.exe -ArgumentList "-batch -i $DeployKey -N -R 8080:localhost:8080 $User@$IP" -WindowStyle Hidden
Start-Sleep -Seconds 2
Invoke-SSH 'sudo env DISPLAY=:99 landgod daemon start'
Log 'daemon 已启动'

# Step 9: 验证
Log 'Step 9/9: 验证连接...'
Start-Sleep -Seconds 5
$clients = Invoke-RestMethod -Uri 'http://localhost:8081/clients' -Method Get
$found = $clients.clients | Where-Object { $_.clientName -eq $Name }
if ($found) {
    Log "✅ $Name 已成功连接到 Gateway!"
} else {
    Warn "$Name 尚未出现，可能需要等待几秒..."
}

# 清理
Write-Host ''
Write-Host '========================================='
Write-Host '  🔥 焚毁凭据'
Write-Host '========================================='
Invoke-SSHKey 'rm -f /tmp/landgod-0.1.0.tgz'
Log '临时文件已清理'
Log '密码仅在内存中使用，已随进程结束销毁'

Write-Host ''
Write-Host '========================================='
Write-Host '  ✅ 部署完成!'
Write-Host '========================================='
Write-Host "  设备名: $Name"
Write-Host "  IP: $IP"
Write-Host "  ClientId: $clientId"
Write-Host ''
Write-Host '  后续管理:'
Write-Host '  - 查看设备: curl http://localhost:8081/clients'
Write-Host '  - 执行命令: landgod execute "hostname"'
Write-Host '========================================='
