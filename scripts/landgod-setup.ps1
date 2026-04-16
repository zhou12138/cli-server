Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName = 'XLandGod'
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DistDir = Join-Path $RootDir 'dist'

function Write-Header {
  Write-Host '========================================'
  Write-Host "  $AppName Onboarding"
  Write-Host '========================================'
}

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "'$Name' is required but not found."
  }
}

function Read-YesNo {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][bool]$DefaultYes
  )

  $defaultText = if ($DefaultYes) { 'Y/n' } else { 'y/N' }
  while ($true) {
    $inputValue = Read-Host "$Prompt [$defaultText]"
    if ([string]::IsNullOrWhiteSpace($inputValue)) {
      return $DefaultYes
    }

    switch ($inputValue.Trim().ToLowerInvariant()) {
      'y' { return $true }
      'yes' { return $true }
      'n' { return $false }
      'no' { return $false }
      default { Write-Host 'Please answer yes or no.' }
    }
  }
}

function Select-Mode {
  Write-Host 'Choose startup mode:'
  Write-Host '  1) GUI (图形界面)'
  Write-Host '  2) Headless (无界面，推荐)'

  while ($true) {
    $option = Read-Host 'Select [1-2]'
    switch ($option) {
      '1' { return 'gui' }
      '2' { return 'headless' }
      default { Write-Host 'Invalid option. Please enter 1 or 2.' }
    }
  }
}

function Build-Bundle {
  Write-Host 'Creating app package...'
  Push-Location $RootDir
  try {
    & npm.cmd run make

    if (-not (Test-Path $DistDir)) {
      New-Item -ItemType Directory -Path $DistDir | Out-Null
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $zipPath = Join-Path $DistDir ("$AppName-$timestamp.zip")
    $makePath = Join-Path $RootDir 'out/make'

    if (-not (Test-Path $makePath)) {
      throw "Package output not found: $makePath"
    }

    Write-Host "Compressing output to $zipPath ..."
    if (Test-Path $zipPath) {
      Remove-Item -Path $zipPath -Force
    }
    Compress-Archive -Path "$makePath/*" -DestinationPath $zipPath -Force
    Write-Host "Bundle created: $zipPath"
  }
  finally {
    Pop-Location
  }
}

Write-Header
Test-CommandExists -Name 'npm.cmd'

if (Read-YesNo -Prompt 'Install dependencies now?' -DefaultYes $true) {
  Push-Location $RootDir
  try {
    & npm.cmd install
  }
  finally {
    Pop-Location
  }
}

$mode = Select-Mode

$baseUrl = Read-Host 'Managed MCP base URL (e.g. ws://localhost:8000/api/mcphub/ws)'
$token = Read-Host 'Managed MCP bearer token (optional)'

if (-not [string]::IsNullOrWhiteSpace($baseUrl)) {
  $env:MANAGED_CLIENT_BASE_URL = $baseUrl.Trim()
}
if (-not [string]::IsNullOrWhiteSpace($token)) {
  $env:MANAGED_CLIENT_BEARER_TOKEN = $token.Trim()
  if ($mode -eq 'gui') {
    Write-Host 'Static token detected. Switching to headless mode (no renderer UI required).'
    $mode = 'headless'
  }
}

if (Read-YesNo -Prompt 'Build distributable bundle now?' -DefaultYes $true) {
  Build-Bundle
}

Write-Host 'Launching app...'
Push-Location $RootDir
try {
  switch ($mode) {
    'gui' { & npm.cmd run start:managed-client-mcp-ws-ui }
    'headless' { & npm.cmd run start:managed-client-mcp-ws }
  }
}
finally {
  Pop-Location
}
