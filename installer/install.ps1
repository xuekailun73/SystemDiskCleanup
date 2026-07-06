$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") `
    -Verb RunAs -Wait
  exit
}

Add-Type -AssemblyName System.Windows.Forms

$defaultPath = if (Test-Path "D:\") { "D:\SpaceWatch" } else { Join-Path $env:ProgramFiles "SpaceWatch" }
$dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
$dialog.Description = "Choose SpaceWatch install folder. D drive is recommended."
$dialog.SelectedPath = $defaultPath
$dialog.ShowNewFolderButton = $true

$installDir = $defaultPath
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
  $installDir = $dialog.SelectedPath
}

$sourceRoot = Split-Path -Parent $PSCommandPath
$payload = Join-Path $sourceRoot "payload.zip"
if (-not (Test-Path -LiteralPath $payload)) {
  throw "Broken setup package: payload.zip not found"
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Expand-Archive -LiteralPath $payload -DestinationPath $installDir -Force
New-Item -ItemType Directory -Force -Path (Join-Path $installDir "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installDir "logs") | Out-Null

$taskName = "SpaceWatchCS"
$startScript = Join-Path $installDir "start-spacewatch-server.ps1"

Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

Get-NetTCPConnection -LocalPort 17890 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $pid = $_.OwningProcess
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
  if ($processInfo.CommandLine -like "*server.js*" -or $processInfo.CommandLine -like "*SpaceWatch*") {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DisallowStartIfOnBatteries:$false -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "SpaceWatch"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

foreach ($shortcutPath in @((Join-Path $desktop "SpaceWatch.lnk"), (Join-Path $startMenu "SpaceWatch.lnk"))) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "http://127.0.0.1:17890/"
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  $shortcut.Save()
}

$uninstallShortcut = $shell.CreateShortcut((Join-Path $startMenu "Uninstall SpaceWatch.lnk"))
$uninstallShortcut.TargetPath = "powershell.exe"
$uninstallShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$installDir\uninstall-spacewatch.ps1`""
$uninstallShortcut.WorkingDirectory = $installDir
$uninstallShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,31"
$uninstallShortcut.Save()

$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    $storage = Invoke-RestMethod -Uri "http://127.0.0.1:17890/api/storage" -TimeoutSec 2
    if ($storage.ok) {
      $ready = $true
      break
    }
  } catch {
  }
}

Start-Process "http://127.0.0.1:17890/"

if ($ready) {
    [System.Windows.Forms.MessageBox]::Show("SpaceWatch has been installed and started.`nInstall folder: $installDir", "SpaceWatch", "OK", "Information") | Out-Null
} else {
  [System.Windows.Forms.MessageBox]::Show("SpaceWatch has been installed, but the service health check did not pass yet. Try the desktop shortcut later.`nInstall folder: $installDir", "SpaceWatch", "OK", "Warning") | Out-Null
}
