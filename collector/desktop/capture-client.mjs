import { validateCaptureRequest } from '../src/capture-request.mjs';
export async function captureRequest(owner,input) {
  validateCaptureRequest(input);
  const identity = owner.identity;
  if (!identity) throw new Error('请先登录资料空间；记录已保存在本机');
  if (input.server && input.server !== identity.server) throw new Error('此记录属于另一资料空间，请恢复原连接后重试');
  const binary = input.bytes !== undefined;
  const body = binary ? Buffer.from(input.bytes,'base64') : input.json === undefined ? undefined : JSON.stringify(input.json);
  const response = await owner.fetcher(identity.server+input.route,{method:input.method || 'GET',headers:{Authorization:`Bearer ${identity.token}`,...(body === undefined ? {} : {'Content-Type':binary ? input.mime : 'application/json'})},body,redirect:'error',signal:AbortSignal.timeout(120000)});
  const data = Buffer.from(await response.arrayBuffer());
  if (owner.identity !== identity) throw new Error('登录状态已改变，记录仍保存在本机');
  const mime = response.headers.get('content-type') || '';
  if (mime.startsWith('application/json')) return {status:response.status,json:JSON.parse(data.toString('utf8'))};
  return {status:response.status,bytes:data.toString('base64'),mime};
}
