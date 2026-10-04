import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { atomicJson } from '../src/common.mjs';

const themes = ['system', 'light', 'dark'];
const behaviors = ['tray', 'quit'];

export class DesktopSettings extends EventEmitter {
  constructor({ file, nativeTheme }) {
    super();
    this.file = file;
    this.nativeTheme = nativeTheme;
    this.value = { themeMode: 'system', closeBehavior: 'tray' };
    this.migrationNeeded = true;
    this.revision = 0;
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.version === 1 && themes.includes(stored.themeMode) && behaviors.includes(stored.closeBehavior)) {
        this.value = { themeMode: stored.themeMode, closeBehavior: stored.closeBehavior };
        this.migrationNeeded = false;
      }
    } catch {}
    nativeTheme.themeSource = this.value.themeMode;
    this.changed = () => { this.revision++; this.emit('changed', this.snapshot()); };
    nativeTheme.on('updated', this.changed);
  }
  snapshot() {
    return { ...this.value, resolvedTheme: this.nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      migrationNeeded: this.migrationNeeded, revision: this.revision };
  }
  update(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['themeMode', 'closeBehavior'].includes(key))
      || (Object.hasOwn(input, 'themeMode') && !themes.includes(input.themeMode))
      || (Object.hasOwn(input, 'closeBehavior') && !behaviors.includes(input.closeBehavior))) {
      throw new Error('设置内容无效，请选择支持的显示模式和关闭行为。');
    }
    const value = { ...this.value, ...input };
    try { atomicJson(this.file, { version: 1, ...value }); }
    catch { throw new Error('设置未保存，请检查本机配置目录后重试。'); }
    this.value = value;
    this.migrationNeeded = false;
    this.nativeTheme.themeSource = value.themeMode;
    this.changed();
    return this.snapshot();
  }
  background() { return this.snapshot().resolvedTheme === 'dark' ? '#0f1114' : '#f2f5f8'; }
  dispose() { this.nativeTheme.removeListener('updated', this.changed); }
}
