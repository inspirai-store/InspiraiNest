param(
    [string]$SigningDirectory = "$env:LOCALAPPDATA/PersonalLibrary/signing",
    [string]$CollectorServer,
    [string]$TestJavaExecutable
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot '../../scripts/stage-writing.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Writing assets could not be staged.' }
& node (Join-Path $PSScriptRoot '../../scripts/stage-capture.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Capture asset staging failed.' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$project = Join-Path $repository 'apps/android'
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk" }
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17 or later.' }
$store = Join-Path $SigningDirectory 'android-release.p12'
$passwordFile = Join-Path $SigningDirectory 'android-release.password.xml'
# Releases must reuse the existing identity and its Windows-user DPAPI password.
if (-not (Test-Path $store) -or -not (Test-Path $passwordFile)) { throw 'Existing Android signing identity is required; restore the original key and its matching password under the original Windows account.' }
$secure = Import-Clixml -LiteralPath $passwordFile
$env:LIBRARY_SIGNING_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$env:LIBRARY_SIGNING_STORE = [IO.Path]::GetFullPath($store)
Push-Location $project
try {
    $gradleArgs = @('--no-daemon', ':app:assembleRelease', ':app:testReleaseUnitTest', ':app:lintRelease')
    if (-not $TestJavaExecutable -and (Test-Path "$env:ProgramFiles/Android/Android Studio/jbr/bin/java.exe")) { $TestJavaExecutable = "$env:ProgramFiles/Android/Android Studio/jbr/bin/java.exe" }
    if ($TestJavaExecutable) { $gradleArgs += "-PtestJavaExecutable=$TestJavaExecutable" }
    if ($CollectorServer) { $gradleArgs += "-PcollectorServer=$CollectorServer" }
    & ./gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Release build/check failed.' }
    & node (Join-Path $repository '.github/scripts/stage-android-release.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Release certificate or package verification failed.' }
    Write-Output ('Signed release APK directory: ' + (Join-Path $repository 'collector/mobile/dist'))
} finally {
    Pop-Location
    Remove-Item Env:LIBRARY_SIGNING_PASSWORD,Env:LIBRARY_SIGNING_STORE -ErrorAction SilentlyContinue
}
