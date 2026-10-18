const fs = require('node:fs');
const path = require('node:path');

// Read-only measurement of the real isolated Electron window after REST content arrives.
exports.auditLibraryReader = async (window, buildSha256) => {
  const result = await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const article = document.querySelector('[data-region="阅读正文"]');
      if (article?.textContent.includes('每周选一个主题')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const blocks = Array.from(document.querySelectorAll('[data-region="阅读正文"] h3,[data-region="阅读正文"] h4,[data-region="阅读正文"] p')).map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {text:element.textContent,x:box.x,y:box.y,w:box.width,h:box.height,fontSize:style.fontSize,lineHeight:style.lineHeight,color:style.color};
    });
    const sections = Array.from(document.querySelectorAll('[data-region="阅读正文"] section')).map(element => ({gap:getComputedStyle(element).gap}));
    const list = document.querySelector('[data-region="阅读正文"] ul');
    return {viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},blocks,sections,list:list?{padding:getComputedStyle(list).padding,margin:getComputedStyle(list).margin,lineHeight:getComputedStyle(list).lineHeight}:null};
  })()`);
  const directory = path.resolve(__dirname, '../../../../design-review/desktop-refactor/stage-05-library-v1/evidence');
  const baseline = JSON.parse(fs.readFileSync(path.join(directory, 'markdown-layout-checks.json'))).baseline;
  result.differences = result.blocks.map((block, index) => {
    const expected = baseline[index];
    return {textMatches:block.text===expected?.text,...Object.fromEntries(['x','y','w','h'].map(key=>[key,expected?block[key]-expected[key]:null]))};
  });
  result.passed = result.viewport.width===1240 && result.viewport.height===820 && result.blocks.length===baseline.length && result.differences.every(item=>item.textMatches&&['x','y','w','h'].every(key=>Math.abs(item[key])<=1)) && result.sections.length===3 && result.sections.every(section=>section.gap==='8px') && result.list?.padding==='0px' && result.list?.margin==='0px' && result.list?.lineHeight==='31px';
  result.scope = 'Actual isolated Mac Electron window with REST data; content regions only, not entire-page parity';
  result.buildSha256 = buildSha256;
  fs.writeFileSync(path.join(directory, 'native-markdown-layout-checks.json'), JSON.stringify(result,null,2));
  console.log('Native library reading audit', JSON.stringify({passed:result.passed,blocks:result.blocks.length,differences:result.differences}));
};
