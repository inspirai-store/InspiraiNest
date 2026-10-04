// Only this main-process adapter can register an OS login item. The renderer
// cannot supply a path, command, or launch argument.
export class DesktopLoginItem {
  constructor({ app, platform = process.platform, executable = process.execPath, test = false }) {
    this.app = app;
    this.platform = platform;
    this.executable = executable;
    this.test = test;
    this.enabled = false;
    this.calls = [];
    this.supported = Boolean(app.isPackaged && ['win32', 'darwin'].includes(platform));
    this.openedAtLogin = this.snapshot().wasOpenedAtLogin;
  }
  options() { return this.platform === 'win32' ? { path: this.executable, args: ['--startup'], name: 'InspiraiNest' } : {}; }
  snapshot() {
    if (!this.supported) return { supported: false, registered: false, enabled: false, status: 'unsupported', wasOpenedAtLogin: false };
    if (this.test) return { supported: true, registered: this.enabled, enabled: this.enabled, status: this.enabled ? 'enabled' : 'not-registered', wasOpenedAtLogin: false };
    const item = this.app.getLoginItemSettings(this.options());
    const status = this.platform === 'win32' ? item.openAtLogin && !item.executableWillLaunchAtLogin ? 'disabled-by-system' : item.openAtLogin ? 'enabled' : 'not-registered' : item.status;
    return { supported: true, registered: Boolean(item.openAtLogin), enabled: status === 'enabled', status, wasOpenedAtLogin: Boolean(item.wasOpenedAtLogin) };
  }
  configure(enabled, { explicit = false } = {}) {
    if (!this.supported) { if (enabled) throw new Error('请在安装版客户端中设置开机启动。'); return; }
    if (this.test) { this.enabled = enabled; this.calls.push(enabled); return; }
    const before = this.snapshot();
    // Respect a disable/approval choice made in the OS until the user toggles
    // the preference explicitly inside the application.
    if (before.registered === enabled && !explicit) return;
    this.app.setLoginItemSettings({ ...this.options(), openAtLogin: enabled, ...(this.platform === 'win32' && explicit ? { enabled } : {}) });
    const after = this.snapshot();
    if (enabled && !after.registered && after.status !== 'requires-approval') throw new Error('系统未启用开机启动，请检查系统的登录项设置。');
    if (!enabled && after.registered) throw new Error('开机启动未关闭，请检查系统的登录项设置。');
  }
}
