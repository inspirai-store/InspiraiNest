export type RichText={version:1;title?:any;body:any;captions?:Record<string,any>};
export const localFonts:Record<string,string>;
export function localStyle(value?:Record<string,any>):Record<string,any>;
export function titleDoc(text:string):any;
export function contentIdentity(node:any):any;
export function validateRichText(value:any):RichText;
export function assertRichTextMatches(value:RichText,title:string,body:any,media?:any[]):RichText;

export function richNodeKey(node:any):string;
