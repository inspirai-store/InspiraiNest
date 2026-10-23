type UpdateSafety={register:(callback:()=>void|Promise<void>)=>()=>void};
declare global{interface Window{desktopUpdateSafety?:UpdateSafety}}
export function registerUpdateGuard(callback:()=>void|Promise<void>){return window.desktopUpdateSafety?.register(callback)||(()=>{});}
