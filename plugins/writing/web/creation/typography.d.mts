export type TypographyStyle={font:'serif'|'sans'|'system';size:number;mobileSize:number;color:string;weight:number;lineHeight:number};
export type ArticleTypography={version:1;title?:TypographyStyle;body?:TypographyStyle;caption?:TypographyStyle};
export const typographyDefaults:Record<'title'|'body'|'caption',TypographyStyle>;
export const typographyLimits:Record<'title'|'body'|'caption',[number,number]>;
export const essayTypography:ArticleTypography;
export function typographyVariables(value:ArticleTypography):Record<string,string>;
export function validateTypography(value:unknown):ArticleTypography;
