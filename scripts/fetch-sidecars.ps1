[CmdletBinding()]
param(
    [switch]$Force,
    [string]$FfmpegArchive = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $repoRoot 'src-tauri\binaries'

$ytDlpVersion = '2026.10.26'
$ffmpegVersion = '9.0.2'

$ytDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$ytDlpVersion/yt-dlp.exe"
$ffmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$ffmpegVersion/ffmpeg-$ffmpegVersion-essentials_build.zip"

$ytDlpName = 'yt-dlp-x86_64-pc-windows-msvc.exe'
$ffmpegName = 'ffmpeg-x86_64-pc-windows-msvc.exe'
$ffprobeName = 'ffprobe-x86_64-pc-windows-msvc.exe'
$licenseName = 'ffmpeg-LICENSE.txt'

$ytDlpHash = 'F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D'
$ffmpegHash = '3256173F3F8BFFD7DF12227C68ADF68025EDB1832273A9530688A7BB1ED8EDEC'
$ffprobeHash = 'F0D36ECBBDD3BCFAC3EFA078C96C7271C2E68B3810595552AC3B7F17E9A65C52'
$ffmpegZipHash = '60F467265B1E312373DBCD92200C2618A74850F98D3D078E94296BB3FA2047BA'

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-FileHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    return (Get-Sha256 -Path $Path) -eq $Expected.ToUpperInvariant()
}

function Assert-FileHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-FileHash -Path $Path -Expected $Expected)) {
        throw "$Label checksum mismatch: $Path"
    }
}

function Download-File {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination,
        [string]$LocalPath = ''
    )

    if ($LocalPath) {
        if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) {
            throw "Local archive not found: $LocalPath"
        }
        Write-Host "Using local archive $LocalPath"
        Copy-Item -LiteralPath $LocalPath -Destination $Destination -Force
        return
    }

    Write-Host "Downloading $Url"
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source --fail --location --silent --show-error --retry 3 --retry-delay 2 --output $Destination $Url
        if ($LASTEXITCODE -ne 0) {
            throw "Download failed with exit code $LASTEXITCODE`: $Url"
        }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -MaximumRedirection 5
    }
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('ytm-light-sidecars-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    $ytDlpPath = Join-Path $binDir $ytDlpName
    if (-not $Force -and (Test-FileHash -Path $ytDlpPath -Expected $ytDlpHash)) {
        Write-Host "yt-dlp $ytDlpVersion is already present."
    } else {
        $download = Join-Path $tempDir 'yt-dlp.exe'
        Download-File -Url $ytDlpUrl -Destination $download
        Assert-FileHash -Path $download -Expected $ytDlpHash -Label 'yt-dlp'
        Move-Item -LiteralPath $download -Destination $ytDlpPath -Force
    }

    $ffmpegPath = Join-Path $binDir $ffmpegName
    $ffprobePath = Join-Path $binDir $ffprobeName
    $licensePath = Join-Path $binDir $licenseName
    $ffmpegReady = (Test-FileHash -Path $ffmpegPath -Expected $ffmpegHash) -and
        (Test-FileHash -Path $ffprobePath -Expected $ffprobeHash) -and
        (Test-Path -LiteralPath $licensePath -PathType Leaf)

    if (-not $Force -and $ffmpegReady) {
        Write-Host "FFmpeg $ffmpegVersion is already present."
    } else {
        $zipPath = Join-Path $tempDir 'ffmpeg.zip'
        Download-File -Url $ffmpegUrl -Destination $zipPath -LocalPath $FfmpegArchive
        Assert-FileHash -Path $zipPath -Expected $ffmpegZipHash -Label 'FFmpeg archive'

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $root = "ffmpeg-$ffmpegVersion-essentials_build"
            $entries = @(
                @{ Name = $ffmpegName; Entry = "$root/bin/ffmpeg.exe"; Hash = $ffmpegHash },
                @{ Name = $ffprobeName; Entry = "$root/bin/ffprobe.exe"; Hash = $ffprobeHash },
                @{ Name = $licenseName; Entry = "$root/LICENSE"; Hash = '' }
            )

            foreach ($item in $entries) {
                $entry = $archive.Entries |
                    Where-Object { $_.FullName -eq $item.Entry } |
                    Select-Object -First 1
                if (-not $entry) {
                    throw "FFmpeg archive entry not found: $($item.Entry)"
                }

                $extracted = Join-Path $tempDir $item.Name
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extracted, $true)
                if ($item.Hash) {
                    Assert-FileHash -Path $extracted -Expected $item.Hash -Label $item.Name
                }
                Move-Item -LiteralPath $extracted -Destination (Join-Path $binDir $item.Name) -Force
            }
        } finally {
            $archive.Dispose()
        }
    }

    Assert-FileHash -Path $ytDlpPath -Expected $ytDlpHash -Label 'yt-dlp'
    Assert-FileHash -Path $ffmpegPath -Expected $ffmpegHash -Label 'ffmpeg'
    Assert-FileHash -Path $ffprobePath -Expected $ffprobeHash -Label 'ffprobe'
    if (-not (Test-Path -LiteralPath $licensePath -PathType Leaf)) {
        throw "FFmpeg license file is missing: $licensePath"
    }

    Write-Host "Downloader sidecars are ready in $binDir"
    Write-Host "  yt-dlp $ytDlpVersion"
    Write-Host "  FFmpeg $ffmpegVersion (ffmpeg + ffprobe)"
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
