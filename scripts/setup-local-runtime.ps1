param(
  [string]$NodeMajor = "22",
  [string]$PnpmVersion = "9.15.4"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeRoot = Join-Path $projectRoot ".local\runtime"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

$index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
$node = $index | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.lts } | Select-Object -First 1
if (-not $node) {
  throw "Could not find Node $NodeMajor LTS release from nodejs.org."
}

$version = $node.version
$zipName = "node-$version-win-x64.zip"
$zipPath = Join-Path $runtimeRoot $zipName
$nodeDir = Join-Path $runtimeRoot "node-$version-win-x64"

if (-not (Test-Path $nodeDir)) {
  $url = "https://nodejs.org/dist/$version/$zipName"
  Write-Host "Downloading $zipName..."
  Invoke-WebRequest -Uri $url -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $runtimeRoot -Force
}

$env:PATH = "$nodeDir;$env:PATH"
& "$nodeDir\corepack.cmd" enable --install-directory $nodeDir
& "$nodeDir\corepack.cmd" prepare "pnpm@$PnpmVersion" --activate
& "$nodeDir\pnpm.cmd" install --frozen-lockfile

Write-Host ""
Write-Host "Local runtime is ready."
Write-Host "Node: $(& "$nodeDir\node.exe" -v)"
Write-Host "pnpm: $(& "$nodeDir\pnpm.cmd" -v)"
