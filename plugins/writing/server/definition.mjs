export const definition = {
 id:'writing', ownsJob: task => !!task.writingSessionId || task.purpose === 'selection-writing',
 ownsRoute: route => /^\/api\/(?:writing|selection-writing)(?:\/|$)/.test(route)
};
