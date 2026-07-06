$ErrorActionPreference = "SilentlyContinue"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") `
    -Verb RunAs -Wait
  exit
}

$root = Split-Path -Parent $PSCommandPath

Get-ScheduledTask -TaskName "SpaceWatchCS" | Stop-ScheduledTask
Get-ScheduledTask -TaskName "SpaceWatchCS" | Unregister-ScheduledTask -Confirm:$false

Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*$root*"
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "SpaceWatch.lnk"
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "SpaceWatch"
Remove-Item -LiteralPath $desktopShortcut -Force
Remove-Item -LiteralPath $startMenu -Recurse -Force

Add-Type -AssemblyName System.Windows.Forms
$choice = [System.Windows.Forms.MessageBox]::Show("Delete data folder too? Choose No to keep the data folder.", "Uninstall SpaceWatch", "YesNo", "Question")
if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
  Remove-Item -LiteralPath $root -Recurse -Force
} else {
  Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -ne "data" } | Remove-Item -Recurse -Force
}
