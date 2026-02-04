param(
  [ValidateSet('release', 'profile', 'debug')]
  [string]$Mode = 'release',
  [switch]$SkipJs,
  [switch]$SkipDeps,
  [switch]$SkipIcons
)

$ErrorActionPreference = 'Stop'

function Ensure-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing '$Name'. $Hint"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$flutterRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
Set-Location $flutterRoot

$flutter = $env:FLUTTER_BIN
if ([string]::IsNullOrWhiteSpace($flutter)) {
  $flutter = 'flutter'
}
Ensure-Command $flutter "Install Flutter and ensure it is in PATH, or set FLUTTER_BIN."

$webDir = Join-Path $flutterRoot 'web'
$webIndex = Join-Path $webDir 'index.html'
$webJsDir = Join-Path $webDir 'js'
$webJsPkg = Join-Path $webJsDir 'package.json'
$repoRoot = (Resolve-Path (Join-Path $flutterRoot '..')).Path

if (-not (Test-Path $webIndex)) {
  throw "Missing web assets: $webIndex. Ensure flutter/web has index.html, manifest.json, and favicon assets before building."
}

$faviconSource = Join-Path $repoRoot 'res/icon.png'
$faviconTarget = Join-Path $webDir 'favicon.png'
if (Test-Path $faviconSource) {
  Copy-Item -Path $faviconSource -Destination $faviconTarget -Force
}

& $flutter pub get
if (-not $SkipIcons) {
  & $flutter pub run flutter_launcher_icons
}

if (-not $SkipJs) {
  if (-not (Test-Path $webJsPkg)) {
    throw "Missing '$webJsPkg'. Add the web JS bridge toolchain, or use -SkipJs."
  }
  Ensure-Command npm "Install Node.js (npm) to build web JS dependencies."
  Push-Location $webJsDir
  npm install --no-fund --no-audit
  npm run build
  Pop-Location
}

if (-not $SkipDeps) {
  $depsUrl = 'https://github.com/rustdesk/doc.rustdesk.com/releases/download/console/web_deps.tar.gz'
  $depsTar = Join-Path $webDir 'web_deps.tar.gz'
  Write-Host "Downloading web deps: $depsUrl"
  Invoke-WebRequest -Uri $depsUrl -OutFile $depsTar
  Push-Location $webDir
  tar -xzf $depsTar
  Remove-Item $depsTar -Force
  Pop-Location
}

$flutterArgs = @("build", "web", "--$Mode")
if (-not [string]::IsNullOrWhiteSpace($env:RS_PUB_KEY)) {
  $flutterArgs += "--dart-define=RS_PUB_KEY=$($env:RS_PUB_KEY)"
}
if (-not [string]::IsNullOrWhiteSpace($env:RENDEZVOUS_SERVERS)) {
  $flutterArgs += "--dart-define=RENDEZVOUS_SERVERS=$($env:RENDEZVOUS_SERVERS)"
}
if (-not [string]::IsNullOrWhiteSpace($env:API_SERVER)) {
  $flutterArgs += "--dart-define=API_SERVER=$($env:API_SERVER)"
}

& $flutter @flutterArgs
