import type { CaptureInput, CaptureReply, Connection, RecordTransport } from './types.ts';
export type CaptureBridge = { status(): Promise<Connection>; capture(input: CaptureInput): Promise<CaptureReply> };
export function desktopTransport(bridge: CaptureBridge): RecordTransport {
  return { status: () => bridge.status(), request: input => bridge.capture(input) };
}
export class RequestError extends Error { status: number; code?:string; constructor(message: string, status: number, code?:string) { super(message); this.status = status; this.code=code; } }
export async function requestJson<T>(transport: RecordTransport, input: CaptureInput): Promise<T> {
  const reply = await transport.request(input);
  if (reply.status < 200 || reply.status >= 300) throw new RequestError((reply.json as {error?:string})?.error ?? `服务请求失败（${reply.status}）`, reply.status,(reply.json as {code?:string})?.code);
  return reply.json as T;
}
export async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let result = '';
  for (let start = 0; start < bytes.length; start += 8192) result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(result);
}
export async function sha256(blob: Blob) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2,'0')).join(''); }
