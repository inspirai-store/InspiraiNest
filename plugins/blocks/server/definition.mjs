export const definition = {id:'blocks',ownsJob:task=>task.pluginId==='blocks',ownsRoute:route=>route==='/api/blocks'||route.startsWith('/api/blocks/')};
