$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") `
    -Verb RunAs
  exit
}

Set-Location -LiteralPath $PSScriptRoot
$env:npm_config_cache = Join-Path $PSScriptRoot ".npm-cache"

Get-NetTCPConnection -LocalPort 17890 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $processId = $_.OwningProcess
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if ($processInfo.CommandLine -like "*server.js*") {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

Start-Process "http://127.0.0.1:17890/"
npm.cmd start
