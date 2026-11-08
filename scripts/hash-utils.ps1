# Shared hashing helpers for the Windows build scripts.
#
# SHA-256 is computed through .NET instead of Get-FileHash on purpose. Some CI
# hosts launch Windows PowerShell with a module path inherited from PowerShell 7,
# which hides Microsoft.PowerShell.Utility and makes Get-FileHash unavailable.
# The .NET implementation works in both Windows PowerShell 5.1 and PowerShell 7.

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $bytes = $sha.ComputeHash($stream)
    } finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $sha.Dispose()
    }

    return [System.BitConverter]::ToString($bytes).Replace('-', '')
}
