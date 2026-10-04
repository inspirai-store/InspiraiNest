import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('This local launcher currently supports Windows only');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const output = path.resolve(project, '../.runtime/local-workbench');
const build = path.join(output, 'build');
const exe = path.join(build, 'win-unpacked/InspiraiNest.exe');
const config = path.join(process.env.APPDATA, 'LibraryWorker/worker.local.json');
const run = (program, args) => {
  const result = spawnSync(program, args, { cwd: project, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(program)} exited with ${result.status}`);
};
fs.mkdirSync(output, { recursive: true });
if (!process.argv.includes('--prepare-only')) {
  run(process.execPath, [path.join(project, 'scripts/stage-worker-template.mjs')]);
  run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', '--x64', '--dir', `--config.directories.output=${build}`, '--publish', 'never']);
}
if (!fs.existsSync(exe)) throw new Error('Build the local workbench first');
// Directory builds skip the installer target which normally creates this resource.
const yaml = require('js-yaml');
const packaging = yaml.load(fs.readFileSync(path.join(project, 'electron-builder.yml'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(build, 'win-unpacked/resources/app-update.yml'), yaml.dump({ ...packaging.publish, updaterCacheDirName: `${pkg.name}-updater` }));
const literal = value => '"' + value.replaceAll('"', '""') + '"';
const launcher = path.join(output, 'Start-Workbench.vbs');
fs.writeFileSync(launcher, `Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
If Not files.FileExists(${literal(config)}) Then
  MsgBox "Official Worker configuration was not found. Pair the installed Worker first.", 16, "LingNest"
  WScript.Quit 1
End If
Set environment = shell.Environment("Process")
environment("COLLECTOR_CONFIG") = ${literal(config)}
environment.Remove "ELECTRON_RUN_AS_NODE"
environment.Remove "COLLECTOR_DESKTOP_TEST"
environment.Remove "COLLECTOR_DESKTOP_TRACE"
shell.CurrentDirectory = ${literal(path.dirname(exe))}
shell.Run Chr(34) & ${literal(exe)} & Chr(34), 1, False
`, 'utf16le');
// WScript needs a BOM to read a Unicode script correctly.
fs.writeFileSync(launcher, Buffer.concat([Buffer.from([0xff, 0xfe]), fs.readFileSync(launcher)]));
const shortcutScript = path.join(output, 'Create-Shortcut.vbs');
const wscript = path.join(process.env.SystemRoot, 'System32/wscript.exe');
const shortcutText = `Set shell = CreateObject("WScript.Shell")
Set shortcut = shell.CreateShortcut(shell.SpecialFolders("Desktop") & "\\灵藏本地工作台.lnk")
shortcut.TargetPath = ${literal(wscript)}
shortcut.Arguments = Chr(34) & ${literal(launcher)} & Chr(34)
shortcut.WorkingDirectory = ${literal(output)}
shortcut.IconLocation = ${literal(exe + ',0')}
shortcut.Description = "LingNest local workbench - official library profile"
shortcut.Save
`;
fs.writeFileSync(shortcutScript, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(shortcutText, 'utf16le')]));
run(path.join(process.env.SystemRoot, 'System32/cscript.exe'), ['//nologo', shortcutScript]);
console.log(`Local workbench: ${exe}\nLauncher: ${launcher}`);
