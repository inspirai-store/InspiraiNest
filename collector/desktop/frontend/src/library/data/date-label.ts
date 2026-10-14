export function libraryDateLabel(value:string|null|undefined) {
 if(!value)return '';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).formatToParts(date);
 return `${parts.find(part=>part.type==='month')?.value} 月 ${parts.find(part=>part.type==='day')?.value} 日`;
}
