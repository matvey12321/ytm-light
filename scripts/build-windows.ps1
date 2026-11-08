[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    & npm run build:tauri
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot 'verify-windows-bundle.ps1')
Write-Host 'Unsigned local build complete. This build is not code-signed.'
