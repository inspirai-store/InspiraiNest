export const definition = {
 id:'agent-lab', ownsJob: task => task.purpose === 'codex-trial',
 ownsRoute: route => /^\/api\/tasks\/[^/]+\/trial-(?:targets|choice|report|rerun)$/.test(route)
};
