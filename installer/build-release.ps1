$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$buildRoot = "D:\moon\codex\spacewatch-installer-build"
$payloadRoot = Join-Path $buildRoot "payload"
$outputRoot = "D:\moon\codex\spacewatch-installer-output"
$payloadZip = Join-Path $buildRoot "payload.zip"
$sedPath = Join-Path $buildRoot "SpaceWatchSetup.sed"
$setupExe = Join-Path $outputRoot "SpaceWatchSetup.exe"
$projectOutputRoot = Join-Path $projectRoot "installer\output"
$projectSetupExe = Join-Path $projectOutputRoot "SpaceWatchSetup.exe"

Remove-Item -LiteralPath $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $outputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payloadRoot,$outputRoot,$projectOutputRoot | Out-Null

$rootFiles = @(
  ".npmrc",
  "app.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "README.md",
  "scanner.js",
  "server.js",
  "styles.css"
)

foreach ($file in $rootFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $payloadRoot $file) -Force
}

Push-Location $payloadRoot
try {
  $env:npm_config_cache = Join-Path $buildRoot ".npm-cache"
  npm.cmd ci --omit=dev
} finally {
  Pop-Location
}

$runtimeNode = Join-Path $payloadRoot "runtime\node"
New-Item -ItemType Directory -Force -Path $runtimeNode | Out-Null
Copy-Item -LiteralPath "D:\Program Files\nodejs\node.exe" -Destination (Join-Path $runtimeNode "node.exe") -Force

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload-start-spacewatch-server.ps1") -Destination (Join-Path $payloadRoot "start-spacewatch-server.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload-stop-spacewatch.ps1") -Destination (Join-Path $payloadRoot "stop-spacewatch.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload-uninstall-spacewatch.ps1") -Destination (Join-Path $payloadRoot "uninstall-spacewatch.ps1") -Force

Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZip -Force

$installCmd = Join-Path $PSScriptRoot "install.cmd"
$installPs1 = Join-Path $PSScriptRoot "install.ps1"
$iexpress = Join-Path $env:SystemRoot "System32\iexpress.exe"
Copy-Item -LiteralPath $installCmd -Destination (Join-Path $buildRoot "install.cmd") -Force
Copy-Item -LiteralPath $installPs1 -Destination (Join-Path $buildRoot "install.ps1") -Force

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$setupExe
FriendlyName=SpaceWatch Setup
AppLaunched=install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0=install.cmd
FILE1=install.ps1
FILE2=payload.zip
[SourceFiles]
SourceFiles0=$buildRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@

Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII
$iexpressProcess = Start-Process -FilePath $iexpress -ArgumentList @("/N", "/Q", $sedPath) -Wait -PassThru
$iexpressExitCode = $iexpressProcess.ExitCode

if (-not (Test-Path -LiteralPath $setupExe)) {
  throw "Setup build failed: $setupExe; iexpress exit code: $iexpressExitCode"
}

Copy-Item -LiteralPath $setupExe -Destination $projectSetupExe -Force

Get-Item -LiteralPath $projectSetupExe | Select-Object FullName,Length,LastWriteTime
