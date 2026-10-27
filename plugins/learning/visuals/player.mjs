// No application bridge, credentials, remote assets or generated code enters this player.
export function visualPlayer(course,math){
  const root=document.getElementById('player'),initial=document.body.dataset.lesson;
  const state={lesson:course.some(l=>l.id===initial)?initial:'overview',step:0,params:{},playing:false,menu:false};let timer;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=(key,defaultValue)=>state.params[key]??String(defaultValue),num=(key,defaultValue)=>Number(value(key,defaultValue));
  const colour=t=>`var(--${t||'fg'})`,text=(x,y,label,tone='fg',size=23,anchor='middle')=>`<text x="${x}" y="${y}" fill="${colour(tone)}" font-size="${size}" text-anchor="${anchor}">${(Array.isArray(label)?label:[label]).map((t,i)=>`<tspan x="${x}" dy="${i?size*1.35:0}">${esc(t)}</tspan>`).join('')}</text>`;
  const box=(x,y,w,h,label,tone='line',active=false)=>`<g class="${active?'arrive':''}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${colour(active?'surface':tone==='line'?'surface':'soft-'+tone)}" stroke="${colour(tone)}" stroke-width="${active?3:1.5}"/>${text(x+w/2,y+h/2-(Array.isArray(label)?9:0)+7,label,tone==='line'?'fg':tone,22)}</g>`;
  const arrow=(x,y,xx,yy,tone='blue',dash=false)=>`<path d="M${x},${y} L${xx},${yy}" fill="none" stroke="${colour(tone)}" stroke-width="2.5" marker-end="url(#arrow-${tone})" ${dash?'stroke-dasharray="7 7" class="flow"':''}/>`;
  const bar=(x,y,w,label,tone='green',max=100)=>`<rect x="${x}" y="${y}" width="${max}" height="28" rx="7" fill="${colour('raised')}"/><rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="28" rx="7" fill="${colour(tone)}"/>${text(x,y-12,label,'fg',21,'start')}`;
  const group=(key,title,options,defaultValue)=>`<fieldset><legend>${esc(title)}</legend><div class="choices">${options.map(([v,label])=>`<button data-param="${key}" data-value="${esc(v)}" aria-pressed="${value(key,defaultValue)===String(v)}">${esc(label)}</button>`).join('')}</div></fieldset>`;
  // Lucide icon paths, ISC license: https://lucide.dev/license .
  const icon=name=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({play:'<polygon points="6 3 20 12 6 21 6 3"/>',pause:'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',left:'<path d="m12 19-7-7 7-7m-7 7h14"/>',right:'<path d="M5 12h14m-7-7 7 7-7 7"/>',reset:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"/>',book:'<path d="M12 7v14m-9-3h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5V3h-5a4 4 0 0 0-4 3 4 4 0 0 0-4-3H3z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'})[name]}</svg>`;
  const fact=(label,body)=>`<div class="fact"><span>${esc(label)}</span><output>${esc(body)}</output></div>`;
  function controls(id,s){
    if(id==='tensors')return group('cell','输出位置',[[0,'第 1 格'],[1,'第 2 格'],[2,'第 3 格']],2)+(s===3?group('dtype','每元素',[[2,'2 字节'],[4,'4 字节']],2):'');
    if(id==='transformer')return group('position','查询位置',[[0,'位置 1'],[1,'位置 2'],[2,'位置 3']],2);
    if(id==='prefill-decode')return group('generation','生成位置',[[1,'第 1 个'],[2,'第 2 个'],[3,'第 3 个'],[4,'第 4 个']],2);
    if(id==='kv-cache')return s<3?group('history','这一轮已有位置',[[3,'3 个'],[5,'5 个'],[7,'7 个']],5):group('length','每条上下文',[[4096,'4K'],[8192,'8K'],[16384,'16K']],8192)+group('batch','活跃序列',[[1,'1 条'],[4,'4 条'],[16,'16 条']],1)+group('heads','KV 头',[[32,'MHA · 32'],[8,'GQA · 8'],[1,'MQA · 1']],8)+group('bytes','每元素',[[2,'2 字节'],[1,'1 字节']],2);
    if(id==='scheduler')return s<2?group('round','生成轮次',[[0,'第 1 轮'],[1,'第 2 轮'],[2,'第 3 轮'],[3,'第 4 轮']],1):s===3?group('tokens','缓存长度',[[16,'16 token'],[17,'17 token'],[35,'35 token']],35):'';
    if(id==='quantization')return s<2?group('bits','权重位宽',[[4,'4 位'],[8,'8 位'],[16,'16 位']],4):group('bandwidth','单链路标称上限',[[100,'100 Gb/s'],[200,'200 Gb/s'],[400,'400 Gb/s']],200);
    if(id==='gpu')return s===1||s===2?group('m','矩阵行数 M',[[1,'1'],[32,'32'],[1024,'1024']],1):'';
    if(id==='kernels')return group('tile','输出块宽',[[1,'1'],[2,'2'],[4,'4']],2)+(s===3?group('width','有效宽度',[[3,'3'],[4,'4']],3):'');
    if(id==='compiler')return s===2?group('retain','中间结果 t',[[0,'只需要 z'],[1,'还需要 t']],0):s===3?group('calls','调用次数',[[1,'1 次'],[100,'100 次'],[1000,'1000 次'],[2000,'2000 次']],1000):'';
    if(id==='parallel')return s===1?group('split','张量切分',[[0,'按输出列'],[1,'按输入维']],0):s===3?group('dimension','切分维度',[[0,'专家 EP'],[1,'上下文 CP']],0):'';
    if(id==='collectives')return s<2?group('collective','集合操作',[['AllReduce','AllReduce'],['AllGather','AllGather'],['ReduceScatter','ReduceScatter']],'AllReduce'):s===3?group('ready','通信就绪时刻',[[0,'0 ms'],[10,'10 ms'],[25,'25 ms'],[40,'40 ms']],25):'';
    if(id==='post-training')return s===3?group('fastUpdate','更新阶段',[[0,'原始 20 秒'],[1,'加速至 10 秒']],0):'';
    if(id==='adaptation')return s===1?group('fault','首次分歧位置',[[1,'Attention'],[2,'MLP']],1):s===2?group('sequence','输入长度',[[1,'1'],[17,'17'],[129,'129']],129):'';
    if(id==='architecture')return s===2?group('speedup','热点速度',[[1,'原速'],[2,'2 倍'],[4,'4 倍']],2):s===3?group('plan','方案',[[0,'方案 A'],[1,'方案 B']],0):'';
    if(id==='frontier')return s===0?group('method','新方法',[[0,'KV 压缩'],[1,'推测解码'],[2,'编译缓存']],1):s===2?group('accepted','每轮平均推进',[[1,'1 token'],[2,'2 token'],[4,'4 token']],4):'';
    return '';
  }
  function diagram(id,s,W,H){
    const narrow=W<700,pad=28,C=W/2,span=W-2*pad;let svg='',facts='';
    const row=(labels,y,tones=[],active=-1)=>{const gap=16,w=(span-gap*(labels.length-1))/labels.length;return labels.map((l,i)=>box(pad+i*(w+gap),y,w,66,l,tones[i]||'line',i===active)+(i<labels.length-1?arrow(pad+i*(w+gap)+w+2,y+33,pad+(i+1)*(w+gap)-4,y+33):'')).join('');};
    const chain=(labels,y,highlight,tones=[])=>row(labels,y,labels.map((_,i)=>tones[i]||(i<=highlight?'green':'line')),highlight);
    const cells=(x,y,rows,cols,marked,tone='green',cell=42,labels)=>Array.from({length:rows*cols},(_,i)=>{const active=marked(i);return `<rect x="${x+i%cols*cell}" y="${y+Math.floor(i/cols)*cell}" width="${cell-4}" height="${cell-4}" rx="5" fill="${colour(active?'soft-'+tone:'raised')}" stroke="${colour(active?tone:'line')}"/>`+(labels?text(x+i%cols*cell+(cell-4)/2,y+Math.floor(i/cols)*cell+cell*.6,labels[i]??'',active?tone:'muted',19):'');}).join('');
    if(id==='overview'){
      const main=['文本','token','Prefill','Decode','输出'],gap=12,w=(span-4*gap)/5;
      svg=text(pad,34,'一份请求，贯穿同一套系统','fg',25,'start');
      svg+=main.map((l,i)=>box(pad+i*(w+gap),78,w,68,l,i===2?'orange':i===3?'green':'blue',i===Math.min(s+1,4))+(i<4?arrow(pad+i*(w+gap)+w+1,112,pad+(i+1)*(w+gap)-3,112,'blue',true):'')).join('');
      if(s===0){svg+=arrow(C,150,C,210,'green',true)+box(C-100,218,200,64,'各层 KV 状态','green',true);facts=fact('生成过程','先处理输入，再逐步追加');}
      if(s===1){svg+=arrow(C,150,C,205,'orange',true)+row(narrow?['Attention','MLP','算子']:['Attention','MLP','算子','运行时'],220,['orange','orange','blue','blue'],1)+box(C-115,340,230,64,'芯片 · 显存 · 互联','green',true)+arrow(C,290,C,334,'green',true);facts=fact('计算落点','模型 → 算子 → 设备');}
      if(s===2){svg+=box(pad,235,span*.38,90,['GPU 0','模型的一部分'],'blue',true)+box(W-pad-span*.38,235,span*.38,90,['GPU 1','另一部分'],'blue',true)+arrow(W*.4,279,W*.59,279,'orange',true)+text(C,370,'计算依赖跨过设备边界','orange',23);facts=fact('新增成本','数据交换与同步等待');}
      if(s===3){svg+=chain(['生成','奖励','更新','新权重'],240,3,['green','orange','blue','green'])+`<path d="M${W-pad-30},310 V365 H${pad+30} V310" stroke="${colour('green')}" fill="none" stroke-width="2.5" class="flow" stroke-dasharray="8 6"/>`;facts=fact('后训练','生成与训练在同一轮闭环');}
    }else if(id==='tensors'){
      const X=[1,2,3,4],weights=[1,0,2,0,1,1],Y=[1,2,4,3,4,10],chosen=num('cell',2),cell=narrow?47:62,y=115;
      const xx=pad,wx=narrow?198:350,yx=narrow?385:680;
      svg=text(xx+cell,67,['输入 X','2 × 2'],'blue',24)+cells(xx,y,2,2,i=>Math.floor(i/2)===0&&s>=1,'blue',cell,X);
      svg+=text(wx+cell*1.5,67,['权重 W','2 × 3'],'orange',24)+cells(wx,y,2,3,i=>i%3===chosen&&s>=1,'orange',cell,weights);
      svg+=text(yx+cell*1.5,67,['输出 Y','2 × 3'],'green',24)+cells(yx,y,2,3,i=>i===chosen&&s>=1,'green',cell,s>=2?Y:undefined);
      svg+=text(xx+cell*2+20,y+cell,'×','muted',30)+text(wx+cell*3+20,y+cell,'=','muted',30);
      svg+=text(C,310,s>=2?`Y[0,${chosen}] = 1 × ${weights[chosen]} + 2 × ${weights[chosen+3]} = ${Y[chosen]}`:'M×K 乘 K×N，得到 M×N','fg',narrow?25:30);
      if(s===3){const b=num('dtype',2);svg+=row([`X · ${4*b} B`,`W · ${6*b} B`,`Y · ${6*b} B`],370,['blue','orange','green']);facts=fact('主要浮点操作','2 × 2 × 2 × 3 = 24');}else facts=fact('观察点',s===0?'一个位置对应一行特征':'同一份输入可以参与多个输出');
    }else if(id==='transformer'){
      const pos=num('position',2),a=math.attention(pos),gap=18,w=(span-2*gap)/3;
      svg=box(C-72,22,144,60,`Q · 位置 ${pos+1}`,'blue',true);
      svg+=text(pad,118,'Key → 分数 → 权重 → Value','muted',22,'start');
      [1,0,2].forEach((k,i)=>{const x=pad+i*(w+gap),blocked=i>pos&&s>=1,tone=blocked?'line':'green';svg+=box(x,150,w,64,`K = ${k}`,tone,!blocked)+arrow(C,88,x+w/2,143,blocked?'line':'blue',!blocked);
        if(s>=1)svg+=text(x+w/2,250,blocked?'不可见':`分数 ${a.scores[i]}`,'fg',24);
        if(s>=2)svg+=box(x,280,w,56,blocked?'屏蔽':`${(a.weights[i]*100).toFixed(1)}%`,tone,!blocked);
        if(s>=3)svg+=text(x+w/2,386,`${a.weights[i].toFixed(3)} × ${[10,20,30][i]}`,'green',22);
      });facts=fact(s>=3?'加权输出':'当前查询',s>=3?a.output.toFixed(3):`位置 ${pos+1}，Q = 1`);
      if(s===0)svg+=text(C,392,'Q 查询 · K 匹配 · V 提供内容','fg',25);
    }else if(id==='prefill-decode'){
      const generated=num('generation',2),gap=8,total=8,w=(span-gap*(total-1))/total;
      svg=text(pad,45,s<2?'Prefill：输入是已知的':'Decode：每轮追加新位置','fg',26,'start');
      for(let i=0;i<total;i++){const past=i<4,newest=i===3+generated,tone=past?(s===0?'orange':'green'):newest&&s>=2?'orange':'line';svg+=box(pad+i*(w+gap),120,w,62,String(i+1),tone,newest&&s>=2);}
      svg+=text(pad+2*w+gap,230,'4 个输入位置','green',22)+text(W-pad-2*w-gap,230,'新增输出位置','orange',22);
      if(s<3){svg+=row(s===0?['输入矩阵','模型各层','首 token']:['新 token','读取历史 KV','下一个 token'],325,['blue','green','orange'],Math.min(s,2));}
      else{const ts=[120,150,190,220];svg+=arrow(pad,310,W-pad,310,'line');ts.forEach((t,i)=>{const x=pad+25+i*(span-50)/3;svg+=`<circle cx="${x}" cy="310" r="8" fill="${colour(i?'green':'orange')}"/>`+text(x,355,`${t} ms`,i?'green':'orange',22);});}
      facts=s===3?fact('TTFT','120 ms')+fact('平均 TPOT','(220 − 120) ÷ 3 = 33.3 ms'):fact('本轮推进',s===0?'4 个输入位置':s===1?'第一个输出 token':`第 ${generated} 个新位置`);
    }else if(id==='kv-cache'){
      if(s<3){const history=num('history',5),n=history+1,gap=10,w=(span-gap*(n-1))/n;
        svg=text(pad,40,s===0?'历史 K/V 再算一次':'历史 K/V 直接复用','fg',27,'start');
        for(let i=0;i<n;i++){const x=pad+i*(w+gap),old=i<history,tone=old&&s>0?'green':'orange';svg+=`<g class="${s===1&&old?'cache-store':tone==='orange'?'computing':''} delay-${i}">`+box(x,125,w,70,['K','V'],tone,!old||s===0)+'</g>'+text(x+w/2,244,old?String(i+1):'新','fg',23);if(s===2)svg+=arrow(W-pad-w/2,75,x+w/2,117,'blue',true);}
        if(s===2)svg+=box(W-pad-w/2-28,14,56,54,'Q','blue',true);
        svg+=text(C,326,s===0?`重复计算 ${history} 个历史位置`:`新增位置计算 1 次；保留 ${history} 份历史 KV`,'fg',25);
        svg+=text(C,389,s===2?`本轮仍需读取 ${n} 个可见位置的 KV`:'同一个上下文，不同执行方式',s===2?'blue':'muted',23);
        facts=fact('本轮 K/V 计算位置',s===0?`${n}`:'1')+fact('历史状态读取',s===2?`${history} 个位置`:'下一步看新 Q 如何访问');
      }else{const length=num('length',8192),batch=num('batch',1),heads=num('heads',8),bytes=num('bytes',2),a=math.kv({length,batch,heads,bytes}),gib=a.total/2**30;
        svg=text(C,80,`${gib.toLocaleString('zh-CN',{maximumFractionDigits:3})} GiB`,'green',68)+text(C,128,'未压缩逻辑 KV 数据量','muted',24);
        const rows=Math.min(batch,4),height=145/rows;for(let i=0;i<rows;i++)svg+=`<rect x="${pad}" y="${165+i*height}" width="${span}" height="${height-10}" rx="7" fill="${colour('soft-green')}" stroke="${colour('green')}"/>`+text(C,165+i*height+(height-10)/2+7,batch>4&&i===rows-1?`其余 ${batch-3} 条序列`:`序列 ${i+1} · ${length} token`,'green',22);
        svg+=text(C,366,`2 × 32 层 × ${heads} KV 头 × 128 × ${bytes} 字节`,'fg',23)+text(C,408,`× ${length} token × ${batch} 条序列`,'fg',23);
        facts=fact('每 token 全层 KV',`${a.perToken/1024} KiB`)+fact('设备实际用量','另加权重、工作区、取整和副本');
      }
    }else if(id==='scheduler'){
      if(s<2){const r=num('round',1),times=[['A','B'],['A','B'],[s===0?'空闲':'C','B'],[s===0?'空闲':'C','B']],names=times[r];svg=text(pad,45,s===0?'固定批次':'连续批处理','fg',28,'start');
        ['执行槽 0','执行槽 1'].forEach((l,i)=>{svg+=text(pad,132+i*125,l,'muted',22,'start')+box(C-90,88+i*125,180,80,names[i],names[i]==='空闲'?'line':names[i]==='B'?'blue':'green',true);});
        svg+=text(C,380,r>=2?'A 已完成，B 继续生成':'A 需要 2 轮，B 需要 5 轮','fg',24);facts=fact('当前轮次',`第 ${r+1} 轮`)+fact('空位处理',s===0?'等整批完成':r>=2?'允许 C 加入':'等待迭代边界');
      }else if(s===2){svg=text(C,50,'本轮预算：16 token','fg',30)+box(pad,125,span*.3,100,['Decode','4 × 1 token'],'green',true)+box(pad+span*.34,125,span*.66,100,['分块 Prefill','最多 12 token'],'orange',true);svg+=text(C,325,'4 + 12 = 16','fg',42)+text(C,390,'下轮继续处理剩余长输入','muted',23);facts=fact('这一步的取舍','单步等待与矩阵计算效率');
      }else{const n=num('tokens',35),blocks=Math.ceil(n/16),w=(span-40)/3;svg=text(pad,45,'逻辑块 → 物理块','fg',27,'start');for(let i=0;i<3;i++){svg+=box(pad+i*(w+20),100,w,70,`逻辑 ${i}`,i<blocks?'blue':'line',i<blocks)+arrow(pad+i*(w+20)+w/2,178,pad+((i+2)%3)*(w+20)+w/2,250,'green',true)+box(pad+((i+2)%3)*(w+20),260,w,70,`物理 ${[7,2,9][i]}`,i<blocks?'green':'line',i<blocks);}
        facts=fact('分配块数',`${blocks} 块 × 16 槽`)+fact('尾部空槽',`${blocks*16-n} 个`);svg+=text(C,405,'通过映射访问，不要求物理相邻','fg',24);}
    }else if(id==='quantization'){
      if(s<2){const bits=num('bits',4),levels=bits===4?7:bits===8?127:32767,original=[-1,.2,.8],recovered=original.map(v=>Math.round(v*levels)/levels);
        if(s===0){svg=text(C,45,`教学量化刻度 · ${bits} 位`,'fg',28);original.forEach((v,i)=>{const y=125+i*93;svg+=text(pad,y,`${v.toFixed(1)}`,'blue',26,'start')+arrow(pad+65,y-8,C-55,y-8,'orange',true)+box(C-48,y-35,118,54,String(Math.round(v*levels)),'orange',true)+arrow(C+85,y-8,W-pad-93,y-8,'green',true)+text(W-pad,y,`${recovered[i].toFixed(3)}`,'green',25,'end');});facts=fact('恢复方式',`整数 × ${(1/levels).toFixed(5)}`);
        }else{const gb=70e9*bits/8/1e9;svg=text(C,100,`${gb} GB`,'green',64)+text(C,150,'70B 参数的原始权重位流','muted',23)+bar(pad,240,span*bits/16,`${bits} 位权重`,'green',span)+text(C,345,'未含缩放、对齐与非量化部分','fg',24);facts=fact('速度','还取决于硬件、内核和转换开销');}
      }else{const bw=num('bandwidth',200),ms=2**30/(bw*1e9/8)*1000;svg=row(['Prefill','KV 传输','Decode'],110,['orange','blue','green'],s===2?0:1)+text(C,270,'1 GiB KV','blue',36)+arrow(pad+40,325,W-pad-40,325,'blue',true);facts=fact('理想传输下界',`${ms.toFixed(1)} ms`)+fact('假设',`同一瓶颈链路 ≤ ${bw} Gb/s`);}
    }else if(id==='gpu'){
      if(s===0){const labels=['设备显存','片上缓存 / 共享内存','寄存器','计算'],widths=[span,span*.8,span*.58,span*.34];svg=labels.map((l,i)=>box(C-widths[i]/2,24+i*96,widths[i],60,l,i===3?'orange':'green',i===3)+(i<3?arrow(C,86+i*96,C,113+i*96,'green',true):'')).join('');facts=fact('学习焦点','容量有限，复用减少搬运');
      }else if(s<3){const m=num('m',1),a=math.gemm(m);svg=row([`X · ${m}×1024`,'W · 1024×1024',`Y · ${m}×1024`],70,['blue','orange','green'],0)+text(C,230,`${a.intensity.toFixed(1)} FLOP / byte`,'green',42)+text(C,285,'理想数据量：输入各读一次，输出写一次','muted',22);facts=fact('简化性能上界',`${a.ceiling.toFixed(1)} TFLOP/s`)+fact('假设设备','100 TFLOP/s · 1 TB/s');
      }else{svg=bar(pad,130,span,'原始请求 · 100','line',span)+bar(pad,265,span*.9,'热点快 2 倍后 · 90','green',span)+text(C,380,'80 + 20 ÷ 2 = 90','fg',34);facts=fact('整体加速比',(100/90).toFixed(2)+' 倍');}
    }else if(id==='kernels'){
      const tile=num('tile',2),width=s===3?num('width',3):4,cell=narrow?49:64,xx=C-2*cell;
      svg=text(C,45,s===0?'每个执行单元负责明确的位置':s===3?'越界位置必须屏蔽':'一个 tile 覆盖一块输出','fg',27);
      svg+=cells(xx,93,4,4,i=>i%4<width&&Math.floor(i/4)<tile&&i%4<tile,'orange',cell,Array.from({length:16},(_,i)=>i%4>=width?'×':s===0?i:''));
      if(s===2)svg+=arrow(pad,130,xx-10,130,'blue',true)+text(pad,115,'A 行','blue',23,'start')+arrow(xx+4*cell+5,205,W-pad,205,'green',true)+text(W-pad,250,'B 列','green',23,'end');
      facts=fact('当前输出块',`${tile} × ${tile}`)+fact(s===3?'合法索引':'表达方式',s===3?`0 ≤ i < ${width}`:'CUDA / Triton / TileLang');
      svg+=text(C,410,s===3?'先保证加载合法，再比较性能':'并行分解 → 数据复用 → 边界处理','fg',24);
    }else if(id==='compiler'){
      if(s<3){const retain=num('retain',0),fused=s>=1;svg=box(pad,65,125,70,'x、b','blue',true)+arrow(pad+130,100,C-96,100,'blue',true)+box(C-90,65,180,70,fused?'add + ReLU':'add','orange',true);
        if(!fused)svg+=arrow(C,143,C,213,'blue',true)+box(C-70,220,140,64,'中间 t','blue',true)+arrow(C,291,C,341,'blue',true)+box(C-90,348,180,64,'ReLU → z','green',true);
        else{svg+=arrow(C+96,100,W-pad-115,100,'green',true)+box(W-pad-110,65,110,70,'z','green',true);svg+=text(C,235,'减少中间结果的写回与重读','fg',25);if(s===2&&retain)svg+=arrow(C,145,C,293,'blue',true)+box(C-90,300,180,70,'仍需保存 t','blue',true);else svg+=box(C-135,300,270,70,'不必单独保存 t','green',true);}
        facts=fact('变换条件',s===2&&retain?'不能删除仍被使用的 t':'保持程序语义');
      }else{const count=num('calls',1000),a=math.compile(count),max=Math.max(a.eager,a.compiled);svg=bar(pad,140,span*a.eager/max,`Eager · ${a.eager/1000} s`,'blue',span)+bar(pad,290,span*a.compiled/max,`编译 + 执行 · ${a.compiled/1000} s`,'green',span);facts=fact('回本次数','2000 ÷ (10 − 8) = 1000');}
    }else if(id==='parallel'){
      if(s===0){svg=row(['样本 A','模型副本 0','结果 A'],80,['blue','orange','green'],1)+row(['样本 B','模型副本 1','结果 B'],260,['blue','orange','green'],1);facts=fact('训练时','副本之间还需同步梯度等状态');}
      else if(s===1){const split=num('split',0);svg=text(C,40,split?'按输入维切分：得到部分和':'按输出列切分：得到不同输出片段','fg',26)+box(pad,110,span*.4,100,split?['GPU 0','部分 Y₀']:['GPU 0','Y 的左半'],'blue',true)+box(W-pad-span*.4,110,span*.4,100,split?['GPU 1','部分 Y₁']:['GPU 1','Y 的右半'],'green',true)+arrow(pad+span*.2,217,C-45,310,'blue',true)+arrow(W-pad-span*.2,217,C+45,310,'green',true)+box(C-130,318,260,76,split?'求和：Y₀ + Y₁':'拼接完整 Y','orange',true);facts=fact('通信语义',split?'归约':'按需要收集');}
      else if(s===2){svg=chain(['前几层','中间层','后几层'],115,1,['blue','orange','green'])+text(C,260,'激活逐段交接','fg',30)+box(pad,325,span,66,'阶段不均 → 其他阶段等待','orange',true);facts=fact('流水填充','microbatch 与阶段时长共同影响');}
      else{const cp=num('dimension',0);svg=box(C-110,35,220,66,cp?'长上下文':'路由 token','blue',true)+arrow(C,108,pad+100,205,'blue',true)+arrow(C,108,W-pad-100,205,'blue',true)+box(pad,214,200,100,cp?['GPU 0','前半上下文']:['GPU 0','专家 0、1'],'green',true)+box(W-pad-200,214,200,100,cp?['GPU 1','后半上下文']:['GPU 1','专家 2、3'],'orange',true)+text(C,402,cp?'交换 Attention 需要的信息':'分发与汇合需要按目的地交换','fg',23);facts=fact('切分依据',cp?'上下文 CP':'专家 EP');}
    }else if(id==='collectives'){
      if(s<3){const kind=s===2?'All-to-All':value('collective','AllReduce'),out=math.collective(kind),start=s===2?[['a0','a1'],['b0','b1']]:[[1,2],[3,4]];
        svg=text(C,40,kind,'fg',30);[0,1].forEach(i=>{const x=i?W-pad-200:pad;svg+=box(x,85,200,90,[`rank ${i}`,`[${start[i].join(', ')}]`],i?'green':'blue',true)+arrow(x+100,183,x+100,276,i?'green':'blue',true)+box(x,285,200,90,`[${out[i].join(', ')}]`,i?'green':'blue',true);});svg+=arrow(pad+205,220,W-pad-205,220,'orange',true);facts=fact('最终数据',kind==='AllGather'?'各方片段都收集到每个 rank':kind==='ReduceScatter'?'归约后分片':kind==='All-to-All'?'各片段按目的地交换':'每个 rank 拿到求和结果');
      }else{const ready=num('ready',25),end=math.overlap(ready),scale=span/75;svg=text(pad,40,'计算与通信的依赖时间线','fg',27,'start');svg+=bar(pad,125,40*scale,'独立计算：0 → 40 ms','blue',span)+bar(pad+ready*scale,255,30*scale,`通信：${ready} → ${ready+30} ms`,'green',30*scale)+arrow(pad,345,W-pad,345,'line');[0,25,50,75].forEach(t=>svg+=text(pad+t*scale,385,`${t} ms`,'muted',20));facts=fact('最早完成',`${end} ms`)+fact('串行时','70 ms');}
    }else if(id==='post-training'){
      const labels=['生成','奖励','更新','权重交接'];svg=chain(labels,55,Math.min(s,3),['green','orange','blue','green']);
      if(s===1){svg=row(['0','1','1','2'],190,['orange','orange','orange','orange'])+svg+row(['−1','0','0','+1'],325,['blue','blue','blue','green'])+text(C,295,'每个奖励减去均值 1','fg',25);facts=fact('这只是示意优势','实际损失还取决于算法');}
      else if(s===3){const fast=num('fastUpdate',0),times=[60,10,fast?10:20,5],sum=times.reduce((a,b)=>a+b,0);let x=pad;times.forEach((t,i)=>{const w=span*t/95;svg+=box(x,200,w,80,`${t}s`,['green','orange','blue','green'][i],true);x+=w;});facts=fact('整轮时间',`${sum} 秒`)+fact('相对原始',`${(95/sum).toFixed(2)} 倍`);svg+=text(C,355,'阶段占比决定局部优化的整体收益','fg',25);}
      else{svg+=box(C-130,220,260,90,s===0?['当前策略 v1','生成回答或轨迹']:['更新后的策略 v2','供下一轮生成'],'green',true)+arrow(C,338,C,420,'green',true);facts=fact('版本跟踪',s===0?'记录样本由哪个策略生成':'布局转换、传输与重分片');}
    }else if(id==='adaptation'){
      if(s===0||s===3){svg=chain(s===0?['模型','框架','算子']:['时间线','主要热点','改动层次'],55,2)+chain(s===0?['编译','运行时','硬件']:['正确性','性能','升级回归'],245,2,['blue','green','orange']);svg+=arrow(W-pad-55,130,W-pad-55,205,'blue',true);facts=fact('适配目标',s===0?'逐层建立正确执行链':'依据证据缩小改动范围');}
      else if(s===1){const fault=num('fault',1),names=['Embedding','Attention','MLP'],ref=[1,2,3],actual=ref.map((v,i)=>i>=fault?v+.4:v),col=(span-110)/3;svg=text(pad,45,'相同 token → 逐层比较','fg',28,'start');names.forEach((name,i)=>{const x=pad+80+i*col;svg+=text(x+col/2,102,name,'muted',21)+box(x,135,col-10,70,String(ref[i]),'blue',false)+box(x,255,col-10,70,String(actual[i]),i>=fault?'orange':'green',i===fault);});svg+=text(pad,180,'参考','blue',20,'start')+text(pad,300,'目标','green',20,'start');facts=fact('首次明显偏离',names[fault]);}
      else{const n=num('sequence',129),issue=n>=129;svg=text(C,55,`固定输入长度 ${n}`,'fg',32)+box(pad,150,span*.44,95,['参考路径','相同输入'],'blue',true)+box(W-pad-span*.44,150,span*.44,95,['目标路径',issue?'出现边界错误':'结果一致'],issue?'orange':'green',true)+text(C,350,issue?'优先检查 KV 索引、掩码与块边界':'继续扩大边界输入覆盖','fg',25);facts=fact('此处为故障示意','不是特定设备实测结果');}
    }else if(id==='architecture'){
      if(s===0){svg=row(['同模型','同资源','同负载'],60,['blue','blue','blue'],2)+box(pad,215,span*.47,100,['TTFT','≤ 1 秒'],'green',true)+box(W-pad-span*.47,215,span*.47,100,['ITL','≤ 50 ms'],'green',true);facts=fact('本例条件','假设服务目标');}
      else if(s===1){svg=chain(['排队','CPU','设备','通信'],75,2,['blue','blue','orange','green'])+row(['长 Prefill？','缓存不足？','慢 rank？'],260,['orange','green','blue'],1)+text(C,400,'先找能推翻假设的观测','fg',27);facts=fact('测量重点','发生尖峰时，关键路径在等什么');}
      else if(s===2){const speed=num('speedup',2),time=80+20/speed;svg=bar(pad,130,span,'原始：80 + 20 = 100','blue',span)+bar(pad,285,span*time/100,`优化：80 + 20 ÷ ${speed} = ${time}`,'green',span);facts=fact('整体加速比',`${(100/time).toFixed(2)} 倍`);}
      else{const b=num('plan',0),done=b?120:100,met=b?70:80;svg=text(C,70,b?'方案 B':'方案 A','fg',40)+bar(pad,160,span*done/120,`总处理 ${done} 个`,'blue',span)+bar(pad,300,span*met/120,`成功且达标 ${met} 个`,'green',span);facts=fact('Goodput',`${met} ÷ 20 = ${met/20} 请求/s`)+fact('观察窗口','20 秒，口径相同');}
    }else if(id==='frontier'){
      if(s===0){const m=num('method',1),nodes=['KV 体积','生成轮数','重复编译'],cost=['量化误差、转换开销','草稿、验证与拒绝开销','首次编译、缓存失效'];svg=box(C-130,35,260,70,['KV 压缩','推测解码','编译缓存'][m],'blue',true)+arrow(C,113,C,178,'blue',true)+box(C-130,185,260,70,`减少：${nodes[m]}`,'green',true)+arrow(C,265,C,320,'orange',true)+box(pad,328,span,72,cost[m],'orange',true);facts=fact('先回到原理','节省什么，新增什么');}
      else if(s<3){const accepted=num('accepted',4),time=25/accepted;svg=chain(['草稿提出','目标验证','接受 / 纠正'],70,1,['blue','orange','green'])+text(C,250,s===1?'一轮推进多个候选':`${time.toFixed(2)} ms / token`,'green',44)+text(C,332,s===1?'收益取决于接受与验证效率':`25 ms ÷ ${accepted} 个最终推进 token`,'fg',24);facts=s===1?fact('算法条件','保持目标分布需要正确接受与纠正'):fact('普通生成假设','10 ms / token');}
      else{svg=row(['固定条件','复现方法','对照基线'],75,['blue','orange','green'],2)+row(['质量','关键路径','资源成本'],270,['green','green','green'],2);facts=fact('加入学习路径之前','先找与当前问题相同的瓶颈');}
    }
    return {svg:`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(course.find(l=>l.id===id).steps[s][0])}"><defs>${['line','blue','green','orange'].map(c=>`<marker id="arrow-${c}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="${colour(c)}"/></marker>`).join('')}</defs>${svg}</svg>`,facts};
  }
  let renderedLesson='',renderedParameters='';
  function render(){
    const lesson=course.find(l=>l.id===state.lesson),current=lesson.steps[state.step],allowMenu=document.body.dataset.embedded!=='true'||initial==='overview';
    if(!root.firstChild)root.innerHTML=`<main class="board"><header class="top"><div><span class="course-title"></span><span class="step-count"></span></div>${allowMenu?`<button data-action="course" class="icon-button"></button>`:''}</header>${allowMenu?`<nav class="course-menu" aria-label="选择图解课程" hidden>${course.map(l=>`<button data-lesson="${l.id}">${esc(l.title)}</button>`).join('')}</nav>`:''}<nav class="steps" aria-label="讲解步骤"></nav><div class="lesson-body"><div class="exhibit"><figure id="scene"></figure><aside class="explanation"><h1></h1><p></p><div id="facts" aria-live="polite"></div></aside></div><section class="parameters" aria-label="改变条件"></section></div><footer><button data-action="prev">${icon('left')}上一步</button><div class="playback"><button data-action="play"></button><button data-action="reset" aria-label="从头重看">${icon('reset')}重看</button></div><button data-action="next" class="primary"></button></footer></main>`;
    root.querySelector('.course-title').textContent=lesson.title;root.querySelector('.step-count').textContent=`${state.step+1} / ${lesson.steps.length}`;
    if(allowMenu){const button=root.querySelector('[data-action="course"]');button.innerHTML=icon(state.menu?'close':'book')+(state.menu?'收起':'课程');button.setAttribute('aria-expanded',String(state.menu));root.querySelector('.course-menu').hidden=!state.menu;root.querySelector('.steps').hidden=state.menu;root.querySelector('.lesson-body').hidden=state.menu;root.querySelector('footer').hidden=state.menu;root.querySelectorAll('[data-lesson]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.lesson===state.lesson)));}
    if(renderedLesson!==state.lesson){root.querySelector('.steps').innerHTML=lesson.steps.map(([title],i)=>`<button data-step="${i}"><span>${i+1}</span>${esc(title)}</button>`).join('');renderedLesson=state.lesson;}
    root.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-current',Number(b.dataset.step)===state.step?'step':'false'));
    root.querySelector('.explanation h1').textContent=current[0];root.querySelector('.explanation p').textContent=current[1];
    const key=state.lesson+':'+state.step;
    if(renderedParameters!==key){root.querySelector('.parameters').innerHTML=controls(state.lesson,state.step);renderedParameters=key;}
    else root.querySelectorAll('[data-param]').forEach(b=>{if(state.params[b.dataset.param]!==undefined)b.setAttribute('aria-pressed',String(b.dataset.value===state.params[b.dataset.param]));});
    const previous=root.querySelector('[data-action="prev"]'),playButton=root.querySelector('[data-action="play"]');previous.disabled=state.step===0;
    playButton.innerHTML=icon(state.playing?'pause':'play')+(state.playing?'暂停':'播放');playButton.setAttribute('aria-label',state.playing?'暂停讲解':'自动播放');playButton.setAttribute('aria-pressed',String(state.playing));
    root.querySelector('[data-action="next"]').innerHTML=(state.step===lesson.steps.length-1?'回到开头':'下一步')+icon('right');
    const scene=document.getElementById('scene'),W=scene.clientWidth<640?560:920,H=460,result=diagram(state.lesson,state.step,W,H);scene.innerHTML=result.svg;document.getElementById('facts').innerHTML=result.facts;
    const activeStep=root.querySelector('[data-step][aria-current="step"]'),strip=root.querySelector('.steps');if(activeStep&&(activeStep.offsetLeft<strip.scrollLeft||activeStep.offsetLeft+activeStep.offsetWidth>strip.scrollLeft+strip.clientWidth))strip.scrollLeft=Math.max(0,activeStep.offsetLeft-strip.offsetLeft);
  }
  function stop(){state.playing=false;clearTimeout(timer);}
  function play(){clearTimeout(timer);if(!state.playing)return;timer=setTimeout(()=>{const lesson=course.find(l=>l.id===state.lesson);if(state.step<lesson.steps.length-1){state.step++;render();play();}else{stop();render();}},6500);}
  root.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
    if(d.lesson){stop();state.lesson=d.lesson;state.step=0;state.params={};renderedParameters="";state.menu=false;}
    else if(d.step!==undefined){stop();state.step=Number(d.step);}
    else if(d.param){stop();state.params[d.param]=d.value;}
    else if(d.action==='play'){state.playing=!state.playing;if(state.playing&&state.step===course.find(l=>l.id===state.lesson).steps.length-1)state.step=0;play();}
    else if(d.action==='course'){stop();state.menu=!state.menu;}
    else{stop();if(d.action==='prev')state.step=Math.max(0,state.step-1);if(d.action==='next')state.step=(state.step+1)%course.find(l=>l.id===state.lesson).steps.length;if(d.action==='reset'){state.step=0;state.params={};renderedParameters='';}}
    render();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();render();}});
  document.addEventListener('keydown',e=>{if(e.target!==document.body)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stop();const max=course.find(l=>l.id===state.lesson).steps.length-1;state.step=Math.max(0,Math.min(max,state.step+(e.key==='ArrowRight'?1:-1)));render();}});
  let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(render,100);});
  render();document.body.dataset.ready='true';
}
