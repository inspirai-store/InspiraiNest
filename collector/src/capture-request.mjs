import { requireValue } from './common.mjs';
export function captureBinaryRead({route,method='GET'}) {
  return method==='GET'&&(/^\/api\/records\/media\/[a-f0-9]{64}$/.test(route)||/^\/api\/writing\/sessions\/[a-f0-9-]{36}(?:\/files\/[a-f0-9-]{36}|\/drafts\/[a-f0-9-]{36}\/files\/[a-f0-9]{64})$/.test(route));
}
export function validateCaptureRequest(input) {
  requireValue(input && typeof input === 'object','Invalid capture request');
  const {route,method='GET'} = input;
  const allowed = method === 'GET' && (route === '/api/selection-writing/tasks' || /^\/api\/selection-writing\/tasks\/[a-zA-Z0-9-]+$/.test(route) || route === '/api/state' || route === '/api/records' || /^\/api\/records\/[a-zA-Z0-9-]+$/.test(route) || /^\/api\/records\/media\/[a-f0-9]{64}$/.test(route) || /^\/api\/tasks\/[a-zA-Z0-9-]+\/draft$/.test(route))
    || method === 'PUT' && (/^\/api\/records\/[a-zA-Z0-9-]+$/.test(route) || /^\/api\/records\/media\/[a-f0-9]{64}$/.test(route))
    || method === 'POST' && (route === '/api/selection-writing/tasks' || /^\/api\/selection-writing\/tasks\/[a-zA-Z0-9-]+\/cancel$/.test(route) || /^\/api\/records\/[a-zA-Z0-9-]+\/process$/.test(route) || /^\/api\/tasks\/[a-zA-Z0-9-]+\/(approve|retry|cancel)$/.test(route));
  const writingGet=method==='GET'&&(/^\/api\/writing\/(sessions|styles|entries)$/.test(route)||/^\/api\/writing\/sessions\/[a-f0-9-]{36}(?:\/drafts\/[a-f0-9-]{36}(?:\/files\/[a-f0-9]{64})?|\/files\/[a-f0-9-]{36}|\/history)?$/.test(route));
  const writingPost=method==='POST'&&(/^\/api\/writing\/sessions$/.test(route)||/^\/api\/writing\/sessions\/[a-f0-9-]{36}\/(answers|materials|discuss|start|style|revise)$/.test(route));
  requireValue(allowed||writingGet||writingPost,'Capture route not allowed',403);
  if (input.bytes !== undefined) requireValue(typeof input.bytes === 'string' && input.bytes.length <= 44739244 && method === 'PUT' && route.includes('/media/'),'Invalid media body');
  return input;
}
