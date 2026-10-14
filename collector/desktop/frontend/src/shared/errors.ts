export function errorMessage(error:unknown):string{
  let message=error instanceof Error?error.message:String(error??'操作失败');
  message=message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/,'').replace(/^(?:Error:\s*)+/,'').trim();
  if(/^(?:fetch failed|Failed to fetch|net::ERR_CONNECTION_REFUSED)$/i.test(message))return '连接失败，请重试';
  if(/^(?:The operation was aborted|This operation was aborted|The operation was aborted due to timeout)$/i.test(message))return '请求超时，请重试';
  return message||'操作失败';
}
