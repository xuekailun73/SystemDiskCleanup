$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$env:npm_config_cache = Join-Path $PSScriptRoot ".npm-cache"
$env:SPACEWATCH_PORT = "17890"

$node = Join-Path $PSScriptRoot "runtime\node\node.exe"
$server = Join-Path $PSScriptRoot "server.js"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

& $node $server *> (Join-Path $logDir "server.log")
