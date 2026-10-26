"""Verify UI generation and shared storage identity before distributing an iOS artifact."""
import pathlib, plistlib, subprocess, sys, tempfile, zipfile

def signed_identity(app):
    info=plistlib.loads((app/'Info.plist').read_bytes())
    result=subprocess.run(['codesign','-d','--entitlements',':-',str(app)],check=True,capture_output=True)
    entitlements=plistlib.loads(result.stdout)
    assert info['CollectorKeychainGroup'] in entitlements.get('keychain-access-groups',[]), 'Keychain Info.plist and signature identity differ'
    assert info['CollectorAppGroup'] in entitlements.get('com.apple.security.application-groups',[]), 'App Group Info.plist and signature identity differ'
    return info,entitlements

def verify_app(app,distribution=False):
    info,entitlements=signed_identity(app)
    assert not (app/'CaptureAssets').exists(), 'Retired iOS workbench assets in app'
    assert info.get('InspiraiNestUIBaseline')=='native-v1', 'Unverified iPhone/iPad UI generation; artifact cannot be distributed'
    for extension in (app/'PlugIns').glob('*.appex'):
        shared,rights=signed_identity(extension)
        for key in ['CollectorKeychainGroup','CollectorAppGroup','CFBundleVersion','CFBundleShortVersionString']:
            assert shared[key]==info[key], 'Main app and share extension differ: '+key
        if distribution: assert not rights.get('get-task-allow',False), 'Share extension has development signing'
    if distribution:
        assert not entitlements.get('get-task-allow',False), 'Main app has development signing'
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True,capture_output=True)
    return {'baseline':'native-v1','version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'sharedIdentityVerified':True}

def verify(file):
    file=pathlib.Path(file)
    if file.suffix=='.ipa':
        with zipfile.ZipFile(file) as archive:
            assert not any('/CaptureAssets/' in n for n in archive.namelist()), 'Retired iOS workbench assets in IPA'
        with tempfile.TemporaryDirectory(prefix='ios-artifact-ui-') as folder:
            subprocess.run(['ditto','-x','-k',str(file),folder],check=True,capture_output=True)
            apps=list((pathlib.Path(folder)/'Payload').glob('*.app'));assert len(apps)==1
            return verify_app(apps[0],distribution=True)
    if file.suffix=='.xcarchive':
        apps=list((file/'Products/Applications').glob('*.app'));assert len(apps)==1;file=apps[0]
    return verify_app(file)

if __name__=='__main__': print(verify(sys.argv[1]))
