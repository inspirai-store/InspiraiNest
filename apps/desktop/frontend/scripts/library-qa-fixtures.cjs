// Synthetic archives for local REST validation only.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
exports.seedLibrary = async (api, server, store) => {
  const parity=process.env.LIBRARY_QA_PARITY==='1';
  const excerpts=['从收藏文章到形成自己的理解。','记录观点、问题与具体例子。','用主题连接相关的文章与笔记。','把一个想法拆成可以完成的小事。'];
  const titles = parity?['把阅读变成可积累的知识','如何做好读书笔记','建立自己的知识索引','从灵感到行动']:['如何建立自己的知识体系', '让写作成为思考的方法', '阅读笔记与主题关联', '周末的生活观察'];
  for (let index = 0; index < (parity?(process.env.LIBRARY_QA_EMPTY_TRASH==='1'?18:20):35); index++) {
    const title = parity&&index>=18?titles[index===18?1:3]:titles[index] || `分页资料 ${index + 1}`;
    const paragraph = '有效的阅读不止于收藏。用自己的语言留下要点，把新内容与已有笔记联系起来，并定期回顾，让资料成为可用的知识。';
    const summary=parity&&index<4?excerpts[index]:paragraph;
    const body = `${paragraph}\n\n### 核心要点\n\n- 阅读后先记录自己的理解。\n- 用主题把相关资料连接起来。\n- 定期回看并补充新的想法。\n\n### 实践方法\n\n#### 1. 留下阅读笔记\n\n记录有价值的观点、问题和例子。保留来源，方便以后核对。\n\n#### 2. 建立内容关联\n\n把新文章与已有记录放在一起，找到共同主题和不同观点。\n\n#### 3. 定期回顾\n\n每周选一个主题，重读相关笔记，补充新的理解与应用。`;
    let files = [{ path: 'summary.md', role: 'summary', text: body }, { path: 'analysis.md', role: 'analysis', text: '### 应用分析\n\n先记录理解，再按主题关联已有资料。' }, { path: 'original.md', role: index >= 4 && index <= 8 ? ['source','source_excerpt','source_snapshot','transcript','transcript_raw'][index-4] : 'original', text: Array.from({ length: 250 }, (_, i) => `原文第 ${i + 1} 行：保留来源与完整正文。`).join('\n') }].map(({ text, ...file }) => { const bytes = Buffer.from(text); return { ...file, bytes: bytes.length, sha256: digest(bytes), body: bytes.toString('base64') }; });
    if (process.env.LIBRARY_QA_FILES==='1' && index<2) {
      const fixtures=index===0?[['阅读方法.pdf','document','itinerary.pdf'],['阅读笔记.jpg','image','lake-original.jpg'],['原文.txt','original',null],['摘要.txt','summary',null]]:[['路线.mp4','document','route.mp4'],['摘要.txt','summary',null]];
      if(process.env.LIBRARY_QA_LONG_FILENAMES==='1'&&index===0)fixtures[0][0]='阅读方法与知识积累实践指南_包含引用图片与附件完整性说明_用于验证窄窗口长文件名截断.pdf';
      files=fixtures.map(([name,role,fixture])=>{let bytes=fixture?fs.readFileSync(path.join(__dirname,'../src/records/fixtures',fixture)):Buffer.from(body);if(parity&&index===0){const target=name.endsWith('.pdf')?240*1024:name.endsWith('.jpg')?160*1024:name==='原文.txt'?12*1024:bytes.length;if(target>bytes.length)bytes=Buffer.concat([bytes,Buffer.alloc(target-bytes.length,32)]);}return {path:name,role,bytes:bytes.length,sha256:digest(bytes),body:bytes.toString('base64')};});
    }
    if(process.env.LIBRARY_QA_FILES==='1'&&index===2)files=files.filter(file=>file.role==='summary');
    if(process.env.LIBRARY_QA_EMPTY_ATTACHMENTS==='1'&&index===0)files=files.filter(file=>file.role==='summary');
    const date = new Date(Date.UTC(2026, 9, parity?12-Math.min(index,4):12, 12, 0, -index)).toISOString();
    const meta = { schema_version: 1, id: `qa-library-${index + 1}`, title, summary, type: index === 1 ? 'note' : parity&&index===3?'document':'article', status: index === 3 ? 'partial' : 'archived', verification_status: 'source_only', coverage_note: 'Synthetic isolated QA archive', mode: 'general', scenario: null, tags: index % 2 ? ['写作'] : ['阅读', '知识管理'], aliases: [], related: [], published_at: null, collected_at: date, organized_at: date, verified_at: null, source_url: 'https://example.com/source', canonical_url: null, files: files.map(({ path, role }) => ({ path, role })) };
    const archive=await api({ server }, '/api/archives', 'POST', { version: 1, meta, files, omitted: [] });
    if(process.env.LIBRARY_QA_FILES==='1'&&index>=(parity?18:33)){await api({server},'/api/archives/'+archive.id,'DELETE');if(parity&&store){const item=await store.get('trash',meta.id);await store.put('trash',{...item,deletedAt:index===18?'2026-10-13T05:00:00Z':'2026-10-12T05:00:00Z'});}}
  }
  if(parity)for(let index=0;index<2;index++){const id=crypto.randomUUID();await api({server},'/api/records/'+id,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'原型对照加工记录 '+(index+1),createdAt:'2026-10-12T04:00:00Z',attachments:[]});await api({server},'/api/records/'+id+'/process','POST',{requestId:crypto.randomUUID(),baseVersion:1,preset:'summary',instructions:'',deviceId:null,agent:null});}
};
