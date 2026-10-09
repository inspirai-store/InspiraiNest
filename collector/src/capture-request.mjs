import { requireValue } from './common.mjs';
export function validateCaptureRequest(input) {
  requireValue(input && typeof input === 'object','Invalid capture request');
  const {route,method='GET'} = input;
  const allowed = method === 'GET' && (route === '/api/state' || route === '/api/records' || /^\/api\/records\/[a-zA-Z0-9-]+$/.test(route) || /^\/api\/records\/media\/[a-f0-9]{64}$/.test(route) || /^\/api\/tasks\/[a-zA-Z0-9-]+\/draft$/.test(route))
    || method === 'PUT' && (/^\/api\/records\/[a-zA-Z0-9-]+$/.test(route) || /^\/api\/records\/media\/[a-f0-9]{64}$/.test(route))
    || method === 'POST' && (/^\/api\/records\/[a-zA-Z0-9-]+\/process$/.test(route) || /^\/api\/tasks\/[a-zA-Z0-9-]+\/(approve|retry|cancel)$/.test(route));
  requireValue(allowed,'Capture route not allowed',403);
  if (input.bytes !== undefined) requireValue(typeof input.bytes === 'string' && input.bytes.length <= 44739244 && method === 'PUT' && route.includes('/media/'),'Invalid media body');
  return input;
}
