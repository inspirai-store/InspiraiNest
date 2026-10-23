$ErrorActionPreference = 'Stop'
$verify = Join-Path $PSScriptRoot 'verify-windows-signatures.ps1'
$directory = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
[void](New-Item -ItemType Directory -Path $directory)
try {
    $unsigned = Join-Path $directory 'unsigned.dll'
    Add-Type -TypeDefinition 'public class UnsignedReleaseGateFixture {}' -OutputAssembly $unsigned
    try {
        & $verify -Files @($unsigned) -PublisherName 'Not a release publisher'
        throw 'Unsigned fixture was incorrectly accepted'
    } catch {
        if ($_.Exception.Message -notlike 'SIGNATURE_INVALID:*') { throw }
    }
    $trusted = Join-Path $PSHOME 'pwsh.exe'
    if ((Get-AuthenticodeSignature -LiteralPath $trusted).Status -ne 'Valid') { throw 'Runner requires a genuinely trusted signed fixture' }
    try {
        & $verify -Files @($trusted) -PublisherName 'Not the Microsoft publisher'
        throw 'Wrong publisher was incorrectly accepted'
    } catch {
        if ($_.Exception.Message -notlike 'SIGNATURE_PUBLISHER_MISMATCH:*') { throw }
    }
    Write-Output 'PASS: unsigned and wrong-publisher files cannot pass the Windows release gate'
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
}
