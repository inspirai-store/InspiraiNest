param([string]$SigningDirectory = "$env:LOCALAPPDATA/PersonalLibrary/signing")
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk" }
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17 or later.' }
$store = Join-Path $SigningDirectory 'android-release.p12'
$passwordFile = Join-Path $SigningDirectory 'android-release.password.xml'
New-Item -ItemType Directory -Force -Path $SigningDirectory | Out-Null
# The password is protected by this Windows user through DPAPI, outside the repository.
if ((Test-Path $store) -ne (Test-Path $passwordFile)) { throw 'Incomplete signing identity; restore the matching key and password before building.' }
if (-not (Test-Path $store)) {
    $randomBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $secure = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    $secure | Export-Clixml -LiteralPath $passwordFile
}
$secure = Import-Clixml -LiteralPath $passwordFile
$env:LIBRARY_SIGNING_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$env:LIBRARY_SIGNING_STORE = [IO.Path]::GetFullPath($store)
Push-Location $project
try {
    if (-not (Test-Path $store)) {
        & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $store -storetype PKCS12 -alias personal-library -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Personal Library Android' -storepass:env LIBRARY_SIGNING_PASSWORD -keypass:env LIBRARY_SIGNING_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Signing key creation failed.' }
    }
    & ./gradlew.bat --no-daemon :app:assembleRelease :app:testReleaseUnitTest :app:lintRelease
    if ($LASTEXITCODE -ne 0) { throw 'Release build/check failed.' }
    $dist = [IO.Path]::GetFullPath((Join-Path $project '../dist'))
    $buildConfig = Get-Content -LiteralPath "$project/app/build.gradle" -Raw
    $version = [regex]::Match($buildConfig, "versionName '([^']+)'").Groups[1].Value
    $versionCode = [int][regex]::Match($buildConfig, 'versionCode (\d+)').Groups[1].Value
    if (-not $version -or $versionCode -lt 1) { throw 'Missing Android release version.' }
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $apk = Join-Path $dist "InspiraiNest-v$version-Android.apk"
    Copy-Item -LiteralPath "$project/app/build/outputs/apk/release/app-release.apk" -Destination $apk -Force
    & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $digest = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $digest | Set-Content -LiteralPath "$apk.sha256" -Encoding ascii
    @{ version = $version; versionCode = $versionCode; filename = [IO.Path]::GetFileName($apk); sha256 = $digest; size = (Get-Item -LiteralPath $apk).Length; publishedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dist 'android-release.json') -Encoding utf8NoBOM
    Write-Output "Signed release APK: $apk"
} finally {
    Pop-Location
    Remove-Item Env:LIBRARY_SIGNING_PASSWORD,Env:LIBRARY_SIGNING_STORE -ErrorAction SilentlyContinue
}
