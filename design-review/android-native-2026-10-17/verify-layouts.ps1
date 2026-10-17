param([string]$Serial='emulator-5580',[string]$Adb="$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe")
$ErrorActionPreference='Stop'
if($Serial -notmatch '^emulator-\d+$'){throw 'Only the dedicated QA emulator is allowed.'}
function Invoke-QAAdb([string[]]$Arguments){
    $result=& $Adb -s $Serial @Arguments 2>&1
    if($LASTEXITCODE -ne 0){throw ($result -join "`n")}
    return ($result -join "`n")
}
if((Invoke-QAAdb -Arguments @('emu','avd','name')) -notmatch '(?m)^LingNest_Attachment_QA\s*$'){throw 'This is not LingNest_Attachment_QA.'}
$originalSize=Invoke-QAAdb -Arguments @('shell','wm','size')
$originalDensity=Invoke-QAAdb -Arguments @('shell','wm','density')
$originalFont=(Invoke-QAAdb -Arguments @('shell','settings','get','system','font_scale')).Trim()
if($originalFont -notmatch '^\d+(\.\d+)?$'){$originalFont='1.0'}
$cases=@(
    @{name='412-default';size='824x1784';font='1.0';all=$true},
    @{name='360-default';size='720x1600';font='1.0'},
    @{name='393-default';size='786x1704';font='1.0'},
    @{name='393-font-1.3';size='786x1704';font='1.3'},
    @{name='360-font-2.0';size='720x1600';font='2.0'},
    @{name='640-landscape';size='1280x720';font='1.0'},
    @{name='960-tablet';size='1920x1200';font='1.0'}
)
$results=@()
try {
    foreach($case in $cases){
        Invoke-QAAdb -Arguments @('shell','am','force-stop','store.inspirai.library') | Out-Null
        Invoke-QAAdb -Arguments @('shell','wm','size',$case.size) | Out-Null
        Invoke-QAAdb -Arguments @('shell','wm','density','320') | Out-Null
        Invoke-QAAdb -Arguments @('shell','settings','put','system','font_scale',$case.font) | Out-Null
        $folder=Join-Path $PSScriptRoot "emulator/$($case.name)"
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $test='store.inspirai.library.NativeComposeFlowTest'
        if(-not $case.all){$test+='#nativeTabsReaderReturnAndBothThemesRender'}
        Write-Output "Checking $($case.name)"
        $log=Invoke-QAAdb -Arguments @('shell','am','instrument','-w','-e','class',$test,'store.inspirai.library.test/androidx.test.runner.AndroidJUnitRunner')
        $log | Set-Content -LiteralPath (Join-Path $folder 'instrumentation.txt') -Encoding utf8
        if($log -notmatch 'OK \((\d+) tests?\)'){throw "UI checks failed: $($case.name). See instrumentation.txt"}
        $count=[int]$Matches[1]
        $images=@('light-library','light-records','light-tasks','light-account','light-reader','dark-library','dark-records','dark-tasks','dark-account','dark-reader','dark-reader-code-table')
        if($case.all){$images+=@('light-share-record','light-record-editor','light-trial-report')}
        foreach($name in $images){Invoke-QAAdb -Arguments @('pull',"/sdcard/Android/data/store.inspirai.library/files/native-qa/$name.png",(Join-Path $folder "$name.png")) | Out-Null}
        $results+=@{case=$case.name;pixels=$case.size;density=320;fontScale=$case.font;tests=$count;passed=$true}
        $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'layout-results.json') -Encoding utf8
        Write-Output "Passed $($case.name): $count tests"
    }
} finally {
    Invoke-QAAdb -Arguments @('shell','am','force-stop','store.inspirai.library') | Out-Null
    if($originalSize -match 'Override size: (\d+x\d+)'){Invoke-QAAdb -Arguments @('shell','wm','size',$Matches[1]) | Out-Null}else{Invoke-QAAdb -Arguments @('shell','wm','size','reset') | Out-Null}
    if($originalDensity -match 'Override density: (\d+)'){Invoke-QAAdb -Arguments @('shell','wm','density',$Matches[1]) | Out-Null}else{Invoke-QAAdb -Arguments @('shell','wm','density','reset') | Out-Null}
    Invoke-QAAdb -Arguments @('shell','settings','put','system','font_scale',$originalFont) | Out-Null
}
