param([string]$Serial, [switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$version = [regex]::Match((Get-Content -LiteralPath (Join-Path $PSScriptRoot '../android/app/build.gradle') -Raw), "versionName '([^']+)'").Groups[1].Value
$apkName = if ($DebugBuild) { "InspiraiNest-v$version-Android-debug.apk" } else { "InspiraiNest-v$version-Android.apk" }
$apk = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../dist/$apkName"))
if (-not (Test-Path -LiteralPath $apk)) { throw 'Build the selected APK first: build-release-android.ps1 or build-android.ps1 for -DebugBuild.' }
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) { $adb = "$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" }
if (-not (Test-Path -LiteralPath $adb)) { throw 'Android platform-tools/adb is required.' }
$connected = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
if ($Serial) { if ($Serial -notin $connected) { throw 'Selected device is not connected and authorized.' } }
elseif ($connected.Count -eq 1) { $Serial = $connected[0] }
else { throw 'Connect one authorized Android device, or specify -Serial. No device has been modified.' }
& $adb -s $Serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $adb -s $Serial shell am start -n store.inspirai.library/.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'App launch failed.' }
