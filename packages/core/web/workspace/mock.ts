// Fixed content frozen with the approved Pencil v1. No persistence or network calls.
export const records = [
  { title: '本周阅读计划', excerpt: '读完文章，留下自己的理解。', date: '今天 14:32', state: '未加工' },
  { title: '周末徒步路线', excerpt: '湖边步道、午餐与返程安排。', date: '今天 11:08', state: '待同步' },
  { title: '关于写作的一点想法', excerpt: '先写下真实的观察，再整理表达。', date: '昨天 18:40', state: '待确认' },
  { title: '最近的阅读摘记', excerpt: '把阅读中有用的观点整理在一起。', date: '昨天 09:15', state: '已归档' },
] as const;
export const library = [
  { title: '把阅读变成可积累的知识', excerpt: '从收藏文章到形成自己的理解。', date: '10 月 12 日', state: '文章 · 已归档' },
  { title: '如何做好读书笔记', excerpt: '记录观点、问题与具体例子。', date: '10 月 11 日', state: '笔记 · 已归档' },
  { title: '建立自己的知识索引', excerpt: '用主题连接相关的文章与笔记。', date: '10 月 10 日', state: '文章 · 已归档' },
  { title: '从灵感到行动', excerpt: '把一个想法拆成可以完成的小事。', date: '10 月 9 日', state: '文档 · 待补齐' },
] as const;
export const recordBody = '这周想读完三篇关于知识管理的文章。\n每篇读完后，留下一条自己的想法，\n再把有价值的内容整理进资料库。\n\n周三：整理最近收藏的文章。\n周五：回顾阅读笔记，补充关联资料。';
export const editorBody = '本周阅读计划\n\n' + recordBody;

export const libraryBody = '有效的阅读不止于收藏。用自己的语言留下要点，把新内容与已有笔记联系起来，并定期回顾，让资料成为可用的知识。\n\n### 核心要点\n\n- 阅读后先记录自己的理解。\n- 用主题把相关资料连接起来。\n- 定期回看并补充新的想法。\n\n### 实践方法\n\n#### 1. 留下阅读笔记\n\n记录有价值的观点、问题和例子。保留来源，方便以后核对。\n\n#### 2. 建立内容关联\n\n把新文章与已有记录放在一起，找到共同主题和不同观点。\n\n#### 3. 定期回顾\n\n每周选一个主题，重读相关笔记，补充新的理解与应用。';
