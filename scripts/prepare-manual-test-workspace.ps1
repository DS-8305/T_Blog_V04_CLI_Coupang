param(
  [string]$TemplatePath = "manual-test-workspaces\templates\stability-suite",
  [string]$RunPath = "manual-test-workspaces\runs\stability-suite",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$templateRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot $TemplatePath)
$runRootPath = Join-Path $projectRoot $RunPath
$manualRunsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "manual-test-workspaces\runs"))
$resolvedRunRoot = [System.IO.Path]::GetFullPath($runRootPath)

if (-not $resolvedRunRoot.StartsWith($manualRunsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "RunPath must stay under manual-test-workspaces\runs"
}

if ($Clean -and (Test-Path -LiteralPath $resolvedRunRoot)) {
  Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $resolvedRunRoot | Out-Null

Get-ChildItem -LiteralPath $templateRoot -Directory | Sort-Object Name | ForEach-Object {
  $target = Join-Path $resolvedRunRoot $_.Name
  New-Item -ItemType Directory -Force -Path $target | Out-Null

  $content = Join-Path $_.FullName "content.txt"
  if (Test-Path -LiteralPath $content) {
    Copy-Item -LiteralPath $content -Destination (Join-Path $target "content.txt") -Force
  }

  $images = Join-Path $_.FullName "images"
  if (Test-Path -LiteralPath $images) {
    Copy-Item -LiteralPath $images -Destination $target -Recurse -Force
  }

  foreach ($artifact in @("_SUCCESS.done", "status.json", "run-log.txt", "automation-diagnostics")) {
    $artifactPath = Join-Path $target $artifact
    if (Test-Path -LiteralPath $artifactPath) {
      Remove-Item -LiteralPath $artifactPath -Recurse -Force
    }
  }
}

Write-Host "Prepared manual test run workspace: $resolvedRunRoot"
