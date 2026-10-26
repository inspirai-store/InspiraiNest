"""Verify UI generation before an iOS archive/IPA may be handed to testers."""
import pathlib, plistlib, sys, zipfile

def verify(file):
    file=pathlib.Path(file)
    if file.suffix=='.ipa':
        with zipfile.ZipFile(file) as archive:
            infos=[n for n in archive.namelist() if n.startswith('Payload/') and n.count('/')==2 and n.endswith('/Info.plist')]
            assert len(infos)==1, 'Missing main application Info.plist'
            info=plistlib.loads(archive.read(infos[0]))
            assert not any('/CaptureAssets/' in n for n in archive.namelist()), 'Retired iOS workbench assets in IPA'
    else:
        if file.suffix=='.xcarchive':
            apps=list((file/'Products/Applications').glob('*.app')); assert len(apps)==1;file=apps[0]
        info=plistlib.loads((file/'Info.plist').read_bytes())
        assert not (file/'CaptureAssets').exists(), 'Retired iOS workbench assets in app'
    assert info.get('InspiraiNestUIBaseline')=='native-v1', 'Retired iPhone/iPad UI generation; artifact cannot be distributed'
    return {'baseline':'native-v1','version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion']}

if __name__=='__main__':
    print(verify(sys.argv[1]))
