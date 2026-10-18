export const definition = {
 id:'ai-assistant',
 ownsJob: task => task.purpose !== 'core-capture',
 ownsRoute: route => /^\/api\/(?:skills|skill-market|skillhub|agents)(?:\/|$)/.test(route) || /^\/api\/records\/[^/]+\/process$/.test(route)
};
