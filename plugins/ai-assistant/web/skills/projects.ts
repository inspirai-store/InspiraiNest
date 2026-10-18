export function projectPaths(values:string[]):string[]{
 const paths=[...new Set(values.map(value=>value.trim()).filter(Boolean))];
 if(paths.length>10||paths.some(path=>path.length<2||path.length>1000||/[\u0000-\u001f]/.test(path)))throw Error('项目目录无效');
 return paths;
}
