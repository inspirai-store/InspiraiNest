param(
    [Parameter(Mandatory = $true)][string[]]$Files,
    [Parameter(Mandatory = $true)][string]$PublisherName
)
$ErrorActionPreference = 'Stop'
$receipts = foreach ($file in $Files) {
    $item = Get-Item -LiteralPath $file
    if ($item.PSIsContainer) { throw 'SIGNATURE_FILE_REQUIRED' }
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
    if ($signature.Status -ne 'Valid') { throw "SIGNATURE_INVALID: $($item.Name): $($signature.Status)" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne $PublisherName) { throw "SIGNATURE_PUBLISHER_MISMATCH: $($item.Name)" }
    if (-not $signature.TimeStamperCertificate) { throw "SIGNATURE_TIMESTAMP_MISSING: $($item.Name)" }
    [ordered]@{
        filename = $item.Name
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        status = [string]$signature.Status
        publisher = $publisher
        thumbprint = $signature.SignerCertificate.Thumbprint
        timestamped = $true
    }
}
ConvertTo-Json -InputObject @($receipts) -Depth 5
