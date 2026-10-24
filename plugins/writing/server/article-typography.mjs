export const typographyVersion = 1;
export const typographyFonts = {serif:'BlogSerif,"Source Han Serif SC","Noto Serif CJK SC","Songti SC",STSong,serif',sans:'BlogBody,"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif',system:'system-ui,-apple-system,"Segoe UI",sans-serif'};
export const typographyLimits = {title:[22,52],body:[14,26],caption:[11,20]};
export const typographyDefaults = {
 title:{font:'serif',size:36,mobileSize:26,color:'#15171c',weight:400,lineHeight:1.35},
 body:{font:'sans',size:17,mobileSize:16,color:'#15171c',weight:400,lineHeight:1.8},
 caption:{font:'sans',size:12,mobileSize:12,color:'#5c616b',weight:400,lineHeight:1.6}
};
export const essayTypography = {version:1,title:{font:'serif',size:34,mobileSize:27,color:'#242424',weight:400,lineHeight:1.5},body:{font:'serif',size:19,mobileSize:18,color:'#2c2b29',weight:400,lineHeight:1.95},caption:{font:'sans',size:12,mobileSize:12,color:'#727069',weight:400,lineHeight:1.6}};
export function validateTypography(value) {
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 if(!object(value)||value.version!==1||Object.keys(value).some(k=>!['version','title','body','caption'].includes(k)))throw Error('排版设置无效');
 const result={version:1};
 for(const [target,[min,max]] of Object.entries(typographyLimits)){
  if(value[target]===undefined)continue;
  const s=value[target];
  if(!object(s)||Object.keys(s).some(k=>!['font','size','mobileSize','color','weight','lineHeight'].includes(k))||!Object.hasOwn(typographyFonts,s.font)||![s.size,s.mobileSize].every(n=>Number.isInteger(n)&&n>=min&&n<=max)||!/^#[0-9a-f]{6}$/i.test(s.color)||![400,500,600,700].includes(s.weight)||!Number.isFinite(s.lineHeight)||s.lineHeight<1.2||s.lineHeight>2.4)throw Error('排版设置无效');
  result[target]={font:s.font,size:s.size,mobileSize:s.mobileSize,color:s.color.toLowerCase(),weight:s.weight,lineHeight:Math.round(s.lineHeight*100)/100};
 }
 return result;
}
export function typographyVariables(value) {
 const styles=validateTypography(value),vars={};
 for(const t of Object.keys(typographyLimits))if(styles[t]){const s=styles[t];for(const [k,v] of Object.entries({font:typographyFonts[s.font],size:s.size+'px',mobile:s.mobileSize+'px',color:s.color,weight:s.weight,leading:s.lineHeight}))vars['--article-'+t+'-'+k]=String(v);}
 return vars;
}
export function typographyCSS(value) {return '.article-typography{'+Object.entries(typographyVariables(value)).map(([k,v])=>k+':'+v).join(';')+'}';}
export function applyTypography(element,value) {
 const styles=validateTypography(value);
 for(const t of Object.keys(typographyLimits)){
  element.toggleAttribute('data-typography-'+t,Boolean(styles[t]));
  for(const key of ['font','size','mobile','color','weight','leading'])element.style.removeProperty('--article-'+t+'-'+key);
 }
 for(const [key,v] of Object.entries(typographyVariables(styles)))element.style.setProperty(key,v);
}
