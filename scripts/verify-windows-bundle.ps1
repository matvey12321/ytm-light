[CmdletBinding()]
param(
    [switch]$RequireSignature
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'hash-utils.ps1')

$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
$versionPattern = [regex]::Escape($package.version)
$targetRoot = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
    Join-Path $repoRoot 'src-tauri\target'
} elseif ([IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) {
    $env:CARGO_TARGET_DIR
} else {
    Join-Path $repoRoot $env:CARGO_TARGET_DIR
}
$releaseRoot = Join-Path $targetRoot 'release'
$nsisRoot = Join-Path $releaseRoot 'bundle\nsis'
$appExe = Join-Path $releaseRoot 'ytm-light.exe'

if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) {
    throw "Application executable is missing: $appExe"
}

$expectedSidecarHashes = @{
    'yt-dlp' = 'F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D'
    'ffmpeg' = '3256173F3F8BFFD7DF12227C68ADF68025EDB1832273A9530688A7BB1ED8EDEC'
    'ffprobe' = 'F0D36ECBBDD3BCFAC3EFA078C96C7271C2E68B3810595552AC3B7F17E9A65C52'
}

foreach ($name in @('yt-dlp', 'ffmpeg', 'ffprobe')) {
    $candidates = @(
        (Join-Path $releaseRoot "$name.exe"),
        (Join-Path $releaseRoot "$name-x86_64-pc-windows-msvc.exe")
    )
    $sidecar = $candidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $sidecar) {
        throw "Bundled sidecar is missing: $name.exe"
    }
    if ((Get-Item -LiteralPath $sidecar).Length -lt 1MB) {
        throw "Bundled sidecar looks like a placeholder or truncated download: $sidecar"
    }
    $actualHash = Get-Sha256Hex -Path $sidecar
    if ($actualHash -ne $expectedSidecarHashes[$name]) {
        throw "Bundled sidecar checksum mismatch: $sidecar"
    }
}

$setupArtifacts = @(
    Get-ChildItem -LiteralPath $nsisRoot -File -Filter '*.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match $versionPattern }
)
if ($setupArtifacts.Count -eq 0) {
    throw "NSIS installer for version $($package.version) is missing under $nsisRoot."
}

if ($RequireSignature) {
    $signatureFailures = @(
        @($appExe) + @($setupArtifacts | ForEach-Object FullName) |
            ForEach-Object {
                $signature = Get-AuthenticodeSignature -LiteralPath $_
                if ($signature.Status -ne 'Valid') {
                    [pscustomobject]@{
                        Path = $_
                        Status = $signature.Status
                    }
                }
            }
    )
    if ($signatureFailures) {
        $signatureFailures | Format-Table -AutoSize | Out-String | Write-Host
        throw 'One or more Windows artifacts are not validly signed.'
    }
}

$signatureMode = if ($RequireSignature) { 'signed' } else { 'unsigned' }
Write-Host "Verified YTM Light $($package.version) ($signatureMode): application executable and $($setupArtifacts.Count) NSIS installer(s)."
