export type ThemeMode='system'|'light'|'dark';
export type SettingsSnapshot={themeMode:ThemeMode;resolvedTheme:'light'|'dark';closeBehavior:'tray'|'quit';launchAtLogin:boolean;revision:number;loginItem:{supported:boolean;registered?:boolean;enabled?:boolean;status:string};loginError:string|null};
export type SettingsPatch=Partial<Pick<SettingsSnapshot,'themeMode'|'closeBehavior'|'launchAtLogin'>>;
export type SettingsBridge={get():Promise<SettingsSnapshot>;update(input:SettingsPatch):Promise<SettingsSnapshot>;onChanged(callback:(state:SettingsSnapshot)=>void):()=>void};
declare global {interface Window {desktopSettings?:SettingsBridge;}}

/** Settings belong to the local client, independently of the active library account. */
export class SettingsClient {
 private current:SettingsSnapshot|null=null;
 private active=true;
 private stop:(()=>void)|undefined;
 private readonly bridge:SettingsBridge;
 private readonly receive:(state:SettingsSnapshot)=>void;
 constructor(bridge:SettingsBridge,receive:(state:SettingsSnapshot)=>void){
  this.bridge=bridge;this.receive=receive;
  this.stop=bridge.onChanged(state=>this.accept(state));
 }
 private accept(state:SettingsSnapshot){
  if(this.active&&(!this.current||state.revision>=this.current.revision)){this.current=state;this.receive(state);}
 }
 async load(){const state=await this.bridge.get();this.accept(state);return this.current;}
 async update(input:SettingsPatch){const state=await this.bridge.update(input);this.accept(state);return this.current;}
 dispose(){this.active=false;this.stop?.();this.stop=undefined;}
}
