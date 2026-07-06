$ErrorActionPreference = "SilentlyContinue"

Get-ScheduledTask -TaskName "SpaceWatchCS" | Stop-ScheduledTask

$root = Split-Path -Parent $PSCommandPath
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*$root*"
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}
