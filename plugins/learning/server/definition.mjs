export const definition = {
  id:'learning',
  ownsJob:task=>task.pluginId==='learning',
  ownsRoute:route=>route==='/api/learning'||route.startsWith('/api/learning/')
};
