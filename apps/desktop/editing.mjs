export function performEditing(contents,action){
 const methods={copy:'copy',cut:'cut',paste:'paste',pastePlain:'pasteAndMatchStyle'};
 if(typeof action!=='string'||!Object.hasOwn(methods,action))throw Error('编辑操作无效');
 contents[methods[action]]();
}
