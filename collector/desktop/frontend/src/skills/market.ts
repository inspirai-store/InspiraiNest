import type {SkillVersion} from './versions.ts';
export type MarketProvider='skillhub'|'lingnest';
export type MarketSort='updated_at'|'downloads'|'stars'|'installs'|'score';
export type MarketItem={slug:string;name:string;description:string;version:string;category:string;source:string;owner?:string;downloads?:number;stars?:number;installs?:number;requiresApiKey?:boolean|null;paid?:boolean|null;changelog?:string;[key:string]:unknown};
export type MarketRequest={provider:MarketProvider}&({kind:'categories'}|{kind:'detail';slug:string}|{kind:'search';keyword?:string;category?:string;source?:string;sortBy?:MarketSort;order?:'asc'|'desc';page:number;pageSize:number}|{kind:'import';slug?:string;version?:string;versionId?:string;requestId:string});
export type MarketPage={items:MarketItem[];total:number;page:number;pageSize:number};
export type MarketImport={version:SkillVersion;preview:{markdown:string;files:{path:string;bytes:number}[];omitted:unknown[]}};
export function marketImportInput(provider:MarketProvider,item:MarketItem,requestId:string):Extract<MarketRequest,{kind:'import'}>{
 if(provider==='lingnest')return {kind:'import',provider,versionId:item.slug,requestId};
 if(!item.version)throw Error('市场版本无法读取，请重新加载');
 return {kind:'import',provider,slug:item.slug,version:item.version,requestId};
}
