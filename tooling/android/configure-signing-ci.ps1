param(
    [string]$SigningDirectory = "$env:LOCALAPPDATA/PersonalLibrary/signing",
    [string]$Repository = 'inspirai-store/InspiraiNest',
    [string]$ExpectedCertificateSha256 = '9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80'
)
$ErrorActionPreference = 'Stop'
$store = Join-Path $SigningDirectory 'android-release.p12'
$passwordFile = Join-Path $SigningDirectory 'android-release.password.xml'
if (-not (Test-Path $store) -or -not (Test-Path $passwordFile)) {
    throw 'Restore the original Android signing store and its matching DPAPI password file under the original Windows account.'
}
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to the existing JDK.' }
if ($ExpectedCertificateSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid expected certificate digest.' }
$null = Get-Command gh -ErrorAction Stop
$certificate = Join-Path ([IO.Path]::GetTempPath()) ('inspirainest-android-certificate-' + [Guid]::NewGuid().ToString('N') + '.der')
$previousPassword = $env:LIBRARY_SIGNING_PASSWORD
try {
    $secure = Import-Clixml -LiteralPath $passwordFile
    $env:LIBRARY_SIGNING_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
    & "$env:JAVA_HOME/bin/keytool.exe" -exportcert -keystore $store -alias personal-library -storepass:env LIBRARY_SIGNING_PASSWORD -file $certificate
    if ($LASTEXITCODE -ne 0) { throw 'Cannot decrypt the original Android signing identity.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($certificate))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($digest -ne $ExpectedCertificateSha256.ToLowerInvariant()) { throw 'The signing certificate does not match the existing official Android release.' }
    # Secret values travel through stdin and are never command-line arguments.
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($store)) | & gh secret set ANDROID_SIGNING_STORE --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure ANDROID_SIGNING_STORE.' }
    $env:LIBRARY_SIGNING_PASSWORD | & gh secret set ANDROID_SIGNING_PASSWORD --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure ANDROID_SIGNING_PASSWORD.' }
    Write-Output "Existing Android signing certificate verified: $digest"
    Write-Output 'Original signing identity configured for the existing manual signed-release workflow.'
} finally {
    $env:LIBRARY_SIGNING_PASSWORD = $previousPassword
    Remove-Item -LiteralPath $certificate -Force -ErrorAction SilentlyContinue
}
