param([switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot '../../scripts/stage-capture.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Capture assets could not be staged.' }
$androidProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA/Android/Sdk")) {
    $env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
}
Push-Location $androidProject
try {
    $tasks = @(':app:assembleDebug')
    if (-not $SkipChecks) { $tasks += @(':app:testDebugUnitTest', ':app:assembleDebugAndroidTest', ':app:lintDebug') }
    & .\gradlew.bat @tasks
    if ($LASTEXITCODE -ne 0) { throw 'Android build/check failed. See Gradle output.' }
    $delivery = [IO.Path]::GetFullPath((Join-Path $androidProject '../dist'))
    New-Item -ItemType Directory -Force -Path $delivery | Out-Null
    $version = [regex]::Match((Get-Content -LiteralPath "$androidProject/app/build.gradle" -Raw), "versionName '([^']+)'").Groups[1].Value
    $apk = Join-Path $delivery "InspiraiNest-v$version-Android-debug.apk"
    Copy-Item -LiteralPath (Join-Path $androidProject 'app/build/outputs/apk/debug/app-debug.apk') -Destination $apk -Force
    (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash | Set-Content -LiteralPath "$apk.sha256" -Encoding ascii
    Write-Output "Debug APK: $apk"
} finally { Pop-Location }
