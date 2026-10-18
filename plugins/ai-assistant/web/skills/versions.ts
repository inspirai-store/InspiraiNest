import type {SkillPolicy} from './policy.ts';
export type SkillVersion={id:string;schemaVersion:1;hash:string;name:string;description:string;declaredVersion?:string;policy:SkillPolicy;createdAt:string;fileCount?:number;files?:{path:string;bytes:number;sha256:string;executable?:boolean}[];source?:{provider:string;slug:string;version:string};};
export function versionLabel(version:SkillVersion):string{return version.declaredVersion?.trim()||version.hash.slice(0,12);}
