export const unreadableText = (value, questionRun = 3) => typeof value === 'string'
  && (value.includes('\uFFFD') || new RegExp(`\\?{${questionRun},}`).test(value));

export const collectionStageNames = { fetching: '获取来源', transcribing: '字幕与转录', analyzing: '整理分析', archiving: '本机归档' };
