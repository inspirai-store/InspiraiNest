#!/usr/bin/env bash
set -euo pipefail
# Only a disposable CI emulator may be used for fixtures.
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
folder=apps/android/app/build/outputs/apk
node --input-type=module <<'JS'
import fs from 'node:fs';import {createHash} from 'node:crypto';
const base='https://library.inspirai.store';const manifest=await (await fetch(base+'/client-release.json')).json();
const response=await fetch(new URL(manifest.android.browserUrl,base));if(!response.ok)throw Error('Baseline unavailable');
const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==manifest.android.sha256)throw Error('Baseline hash mismatch');
fs.writeFileSync(process.env.RUNNER_TEMP+'/android-baseline.apk',bytes);
JS
adb install -r "$RUNNER_TEMP/android-baseline.apk"
adb install -r -t "$folder/androidTest/release/app-release-androidTest.apk"
uid_before=$(adb shell cmd package list packages -U store.inspirai.library | tr -d '\r')
classes=store.inspirai.library.UpgradePreservationTest,store.inspirai.library.NativeUpgradeMigrationTest
for stage in seed verify; do
  if [[ "$stage" == verify ]]; then
    adb shell am force-stop store.inspirai.library
    adb install -r "$folder/release/app-release.apk"
    test "$uid_before" = "$(adb shell cmd package list packages -U store.inspirai.library | tr -d '\r')"
  fi
  timeout 240 adb shell am instrument -w -e class "$classes" -e stage "$stage" store.inspirai.library.test/androidx.test.runner.AndroidJUnitRunner | tee "$RUNNER_TEMP/upgrade-$stage.txt"
  grep -q 'OK (3 tests)' "$RUNNER_TEMP/upgrade-$stage.txt"
  ! grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$RUNNER_TEMP/upgrade-$stage.txt"
done
classes='store.inspirai.library.NativeComposeFlowTest#continuousSharesReadNewContentAndKeepPreviousDraft,store.inspirai.library.NativeComposeFlowTest#shareAfterReturningClosesOldActivityAndOpensNewShare'
timeout 240 adb shell am instrument -w -e class "$classes" store.inspirai.library.test/androidx.test.runner.AndroidJUnitRunner | tee "$RUNNER_TEMP/share-regressions.txt"
grep -q 'OK (2 tests)' "$RUNNER_TEMP/share-regressions.txt"
! grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$RUNNER_TEMP/share-regressions.txt"
