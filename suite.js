'use strict';
(() => {
  const M = window.Modbus, $ = id => document.getElementById(id);
  const E = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const tools = [
    ['debug','Modbus 调试','RTU / TCP 设备调试、查看点值、标记导出'], ['rtu','Modbus RTU','请求、响应与 CRC 校验'], ['tcp','Modbus TCP','MBAP 报文生成与解析'], ['server','Modbus 服务端','TCP 从站、寄存器设置与客户端读写'], ['rawserial','串口报文','原始 HEX / 文本收发、文件解析与曲线'], ['ascii','Modbus ASCII','ASCII 报文与 LRC 校验'], ['converter','数据转换','整数、浮点数与字节序'],
    ['text','HEX 与文本转换','UTF-8 / ASCII 编码与解码'], ['compare','HEX 报文对比','逐字节检查报文差异'], ['bases','进制转换','大整数的四种进制互转'], ['address','寄存器地址换算','协议偏移与手册引用地址'], ['bits','状态字与位掩码','切换位值、提取字段与掩码'], ['checker','请求响应对照','检查读写请求与响应字段']
  ];
  const typeOptions = selected => Object.keys(M.TYPES).map(type=>`<option ${selected===type?'selected':''}>${type}</option>`).join('');
  const orderOptions = () => M.ORDERS.map(order=>`<option>${order}</option>`).join('');
  const input = (id,label,value='',area=false) => `<label>${label}${area?`<textarea id="${id}" class="mono" rows="4" spellcheck="false">${E(value)}</textarea>`:`<input id="${id}" class="mono" value="${E(value)}" spellcheck="false">`}</label>`;
  const select = (id,label,options) => `<label>${label}<select id="${id}">${options}</select></label>`;
  const opts = values => values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
  const card = (title,body) => `<section class="card"><div class="section-head"><h2>${title}</h2></div>${body}</section>`;
  const err = id => `<p id="${id}-error" class="error" role="alert" hidden></p>`;
  const output = (id,label) => `<div class="output-label">${label}</div><div class="output-row"><input id="${id}" class="mono output" readonly aria-label="${label}"><button class="button" data-copy="${id}" type="button">复制</button></div>`;
  const table = (head,rows) => `<div class="table-scroll"><table class="data-table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const row = cells => `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
  const run = (key,action) => { try { action(); $(`${key}-error`).hidden=true; } catch(error) { $(`${key}-error`).textContent=error.message; $(`${key}-error`).hidden=false; document.querySelectorAll(`#view-${key} .computed`).forEach(el=>{el.innerHTML='';}); document.querySelectorAll(`#view-${key} input[readonly],#view-${key} textarea[readonly]`).forEach(el=>{el.value='';}); } };
  const views = new Map(); let active = '';
  $('tool-sidebar').innerHTML = '<div class="sidebar-label">MODBUS 工具</div>'+tools.map((tool,i)=>(i===7?'<div class="sidebar-label more-label">更多工具</div>':'')+`<a href="#/${tool[0]}" data-route="${tool[0]}"><span class="nav-symbol">${['⌁','▤','⇄','⌂','⇥','▧','⇅','Aa','≠','#','⊞','▦','✓','▥'][i]}</span>${tool[1]}</a>`).join('');
  const mobile=document.createElement('label');mobile.className='mobile-tool-select';mobile.innerHTML=`<span class="sr-only">选择工具</span><select id="mobile-tool">${tools.map(t=>`<option value="${t[0]}">${t[1]}</option>`).join('')}</select>`;$('tool-sidebar').before(mobile);
  function viewHTML(tool) {
    if(tool==='server') return '<div id="server-root"></div>';
    if(tool==='debug') return '<div id="debug-root"></div>';
    if(tool==='rawserial') return '<div id="rawserial-root"></div>';
    if(tool==='converter') return card('数值与字节编码',`<div class="three-grid">${select('conv-mode','输入格式',opts([['dec','十进制 DEC'],['hex','十六进制 HEX']]))}${select('conv-type','数据类型',typeOptions('FLOAT32'))}${select('conv-order','字节序',orderOptions())}</div>${input('conv-value','输入数值','3.14')}${err('converter')}<div id="conv-details" class="computed"></div>${output('conv-hex','十六进制字节')}${output('conv-dec','实际存储数值')}<div id="conv-binary" class="binary-detail computed"></div>`)+card('比较所有类型与字节序','<div id="conv-all" class="computed"></div>')+card('批量转换',`${input('conv-batch','每行一个输入，使用上方的数据类型和输入格式','3.14\n2.5\n-25',true)}<div class="actions spaced"><button id="convert-batch" class="button primary">批量转换</button><button id="export-batch" class="button">导出 CSV</button></div><div id="conv-batch-result" class="computed spaced"></div><p class="helper">64 位整数保留完整精度；HEX 位数不足时在左侧补零。二进制字段按所选类型显示。</p>`);
    if(tool==='text') return card('HEX 与文本互转',`<div class="two-grid">${select('text-direction','转换方向',opts([['hex','HEX → 文本'],['text','文本 → HEX']]))}${select('text-encoding','字符编码',opts([['utf-8','UTF-8'],['ascii','ASCII'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE']]))}</div>${input('text-input','输入内容','48 65 6C 6C 6F 20 E4 B8 AD E6 96 87',true)}${err('text')}<label class="spaced">转换结果<textarea id="text-output" class="mono output" rows="4" readonly></textarea></label><div class="parser-toolbar"><small id="text-count"></small><button class="button" data-copy="text-output">复制结果</button></div><p class="helper">空白与换行原样保留；无效编码会报错。ASCII 仅接受 0–127。</p>`);
    if(tool==='compare') return card('逐字节对比',`<div class="two-grid">${input('compare-a','原始报文','01 03 02 00 01',true)}${input('compare-b','对比报文','01 03 02 00 02',true)}</div><div class="parser-toolbar"><button id="compare-run" class="button primary">对比报文</button><label class="check-label"><input id="compare-only" type="checkbox">只显示差异</label></div>${err('compare')}<div id="compare-stats" class="stats computed"></div><div id="compare-result" class="computed"></div><p class="helper">按相同位置比较，偏移从 0 开始；插入 / 删除后不自动重新对齐。每段最多 4096 字节。</p>`);
    if(tool==='bases') return card('整数进制转换',`<div class="two-grid">${select('base-from','输入进制',opts([[10,'十进制 DEC'],[16,'十六进制 HEX'],[2,'二进制 BIN'],[8,'八进制 OCT']]))}${input('base-value','整数','18446744073709551615')}</div>${err('bases')}${[['bin','二进制 BIN'],['oct','八进制 OCT'],['dec','十进制 DEC'],['hex','十六进制 HEX']].map(([id,label])=>output('base-'+id,label)).join('')}<p class="helper">使用 BigInt 精确转换。负数用负号表示，不自动解释为补码；支持对应的 0b / 0o / 0x 前缀。</p>`);
    if(tool==='address') return card('手册地址与协议偏移',`<div class="three-grid">${select('addr-area','数据区',opts([[4,'保持寄存器 · 4x'],[3,'输入寄存器 · 3x'],[0,'线圈 · 0x'],[1,'离散输入 · 1x']]))}${select('addr-format','引用地址格式',opts([[5,'五位引用地址'],[6,'六位引用地址']]))}${select('addr-mode','输入地址格式',opts([['reference','手册引用地址'],['zero','请求地址（从 0 开始）'],['one','序号（从 1 开始）'],['hex','请求地址 HEX']]))}</div>${input('addr-value','地址','40001')}${err('address')}${output('addr-zero','请求地址（DEC）')}${output('addr-hex','请求地址（HEX）')}${output('addr-one','序号（从 1 开始）')}${output('addr-ref','手册引用地址')}<p class="helper">40001 和 400001 都可对应保持寄存器偏移 0，取决于手册编号方式。协议偏移范围为 0–65535。</p>`);
    if(tool==='bits') return card('状态字与位操作',`<div class="three-grid">${select('bits-width','位宽',opts([[16,'16 位'],[32,'32 位'],[64,'64 位']]))}${select('bits-base','输入进制',opts([[16,'HEX'],[10,'DEC']]))}${input('bits-value','无符号整数','00A5')}</div>${err('bits')}<div id="bits-summary" class="stats computed"></div><div id="bit-grid" class="bit-grid computed"></div><div class="two-grid spaced">${input('bits-start','字段最低位','0')}${input('bits-count','字段位数','4')}</div><div id="bits-field" class="data-strip computed"></div><div class="three-grid spaced">${select('bits-op','掩码运算',opts([['and','AND'],['or','OR'],['xor','XOR'],['not','NOT']]))}${input('bits-mask','掩码（HEX）','000F')}${output('bits-result','运算结果 HEX')}</div><p class="helper">点击方格切换位值，位 0 是最低有效位。字段按无符号整数提取，溢出值不会截断。</p>`);
    if(tool==='checker') return card('检查请求与响应',`${select('checker-transport','报文协议',opts([['rtu','Modbus RTU'],['tcp','Modbus TCP'],['ascii','Modbus ASCII']]))}<div class="two-grid spaced">${input('checker-request','请求报文','01 03 00 00 00 02 C4 0B',true)}${input('checker-response','响应报文','01 03 04 00 01 00 02 2A 32',true)}</div><div class="actions spaced"><button id="checker-run" class="button primary">检查报文</button></div>${err('checker')}<div id="checker-result" class="computed spaced"></div><p class="helper">支持八种常用读写功能码；TCP 同时检查事务 ID。字段吻合不能证明两个串行报文来自同一次通信。</p>`);
    return '<div id="serial-root"></div>';
  }
  function decodeTyped(text,type,order) {
    const bytes=M.parseHex(text),size=M.TYPES[type][0]; if(bytes.length>size)throw Error(`${type} 最多 ${size} 字节。`);
    const padded=new Uint8Array(size);padded.set(bytes,size-bytes.length);return {bytes:padded,value:M.decode(padded,type,order)};
  }
  function conversion(text,type,order,mode) { return mode==='dec'?{bytes:M.encode(text,type,order),value:M.decode(M.encode(text,type,order),type,order)}:decodeTyped(text,type,order); }
  function calcConverter() {run('converter',()=>{
    const text=$('conv-value').value,type=$('conv-type').value,order=$('conv-order').value,mode=$('conv-mode').value,result=conversion(text,type,order,mode);
    $('conv-hex').value=M.hex(result.bytes);$('conv-dec').value=Object.is(result.value,-0)?'-0':String(result.value);
    $('conv-details').innerHTML='<div class="byte-tiles">'+Array.from(result.bytes,(n,i)=>`<div><small>字节 ${i}</small><strong>${M.hex([n])}</strong><code>${n.toString(2).padStart(8,'0')}</code></div>`).join('')+'</div>';
    let binary=Array.from(M.reorder(result.bytes,order),n=>n.toString(2).padStart(8,'0')).join('');
    let detail=`<code>${binary.match(/.{1,8}/g).join(' ')}</code>`;
    if(type.startsWith('FLOAT')) {const e=type==='FLOAT32'?8:11;detail+=`<div class="stats"><span>符号 <b>${binary[0]}</b></span><span>指数 <b>${parseInt(binary.slice(1,1+e),2)}</b></span><span>尾数字段 <b>${BigInt('0b'+binary.slice(1+e))}</b></span></div>`;}
    $('conv-binary').innerHTML=detail;
    $('conv-all').innerHTML=table(['数据类型',...M.ORDERS],Object.keys(M.TYPES).map(t=>row([E(t),...M.ORDERS.map(o=>{try{const r=conversion(text,t,o,mode);return `<code>${mode==='dec'?M.hex(r.bytes):E(String(r.value))}</code>`;}catch(_){return '—';}})])).join(''));
  });}
  let batchRows=[];
  function calcBatch(){run('converter',()=>{
    const lines=$('conv-batch').value.split(/\r?\n/).filter(line=>line.trim());if(lines.length>10000)throw Error('批量最多 10000 行。');
    batchRows=lines.map(text=>[text,...M.ORDERS.map(order=>{try{const r=conversion(text,$('conv-type').value,order,$('conv-mode').value);return $('conv-mode').value==='dec'?M.hex(r.bytes):String(r.value);}catch(error){return '错误：'+error.message;}})]);
    $('conv-batch-result').innerHTML=table(['输入',...M.ORDERS],batchRows.slice(0,200).map(cells=>row(cells.map(E))).join(''))+(batchRows.length>200?'<p class="helper">预览前 200 行，CSV 包含全部结果。</p>':'');
  });}
  function calcText(){run('text',()=>{
    const text=$('text-input').value,encoding=$('text-encoding').value;let bytes,result;
    if($('text-direction').value==='hex') {bytes=M.parseHex(text,true);if(encoding==='ascii'){if(bytes.some(n=>n>127))throw Error('ASCII 字节必须在 00–7F。');result=Array.from(bytes,n=>String.fromCharCode(n)).join('');}else result=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    else {result=text;if(encoding==='ascii'){if(Array.from(text).some(c=>c.codePointAt(0)>127))throw Error('文本包含 ASCII 范围外的字符。');bytes=Uint8Array.from(text,c=>c.charCodeAt(0));}else if(encoding==='utf-8')bytes=new TextEncoder().encode(text);else{const raw=[];for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);raw.push(...(encoding==='utf-16le'?[n&255,n>>>8]:[n>>>8,n&255]));}bytes=Uint8Array.from(raw);}result=M.hex(bytes);}
    if(bytes.length>16384)throw Error('最多支持 16384 字节。');$('text-output').value=result;$('text-count').textContent=`${bytes.length} 字节 · ${Array.from($('text-direction').value==='hex'?result:text).length} 个字符`;
  });}
  function calcCompare(){run('compare',()=>{
    const a=M.parseHex($('compare-a').value,true),b=M.parseHex($('compare-b').value,true);if(Math.max(a.length,b.length)>4096)throw Error('每段最多 4096 字节。');
    const lines=[];let diffs=0,first=-1;for(let i=0;i<Math.max(a.length,b.length);i++){const same=a[i]===b[i];if(!same){diffs++;if(first<0)first=i;}if(!$('compare-only').checked||!same)lines.push(row([i,`0x${i.toString(16).toUpperCase().padStart(4,'0')}`,`<code class="${same?'':'diff-byte'}">${a[i]===undefined?'—':M.hex([a[i]])}</code>`,`<code class="${same?'':'diff-byte'}">${b[i]===undefined?'—':M.hex([b[i]])}</code>`,same?'一致':a[i]===undefined?'新增':b[i]===undefined?'缺失':'不同']));}
    $('compare-stats').innerHTML=`<span>原始 <b>${a.length}</b> 字节</span><span>对比 <b>${b.length}</b> 字节</span><span>差异 <b>${diffs}</b> 处</span><span>首处差异 <b>${first<0?'无':first}</b></span>`;
    $('compare-result').innerHTML=table(['偏移 DEC','偏移 HEX','原始','对比','结果'],lines.join(''));
  });}
  function calcBases(){run('bases',()=>{const n=M.bigintInput($('base-value').value,Number($('base-from').value));for(const [id,base]of[['bin',2],['oct',8],['dec',10],['hex',16]])$('base-'+id).value=n.toString(base).toUpperCase();});}
  function calcAddress(){run('address',()=>{const r=M.referenceAddress($('addr-value').value,$('addr-area').value,$('addr-format').value,$('addr-mode').value);$('addr-zero').value=r.offset;$('addr-hex').value=r.hex;$('addr-one').value=r.one;$('addr-ref').value=r.reference;});}
  function calcBits(){run('bits',()=>{
    const width=Number($('bits-width').value),n=M.bigintInput($('bits-value').value,Number($('bits-base').value)),limit=(1n<<BigInt(width))-1n;
    if(n<0n||n>limit)throw Error(`数值范围为 0–${limit}。`);
    $('bit-grid').innerHTML=Array.from({length:width},(_,i)=>{const bit=width-i-1,on=!!(n&(1n<<BigInt(bit)));return `<button class="bit ${on?'on':''}" data-bit="${bit}" aria-label="位 ${bit}" aria-pressed="${on}"><small>${bit}</small><strong>${on?1:0}</strong></button>`;}).join('');
    const selected=Array.from({length:width},(_,i)=>i).filter(i=>n&(1n<<BigInt(i)));
    $('bits-summary').innerHTML=`<span>HEX <b>${n.toString(16).toUpperCase().padStart(width/4,'0')}</b></span><span>DEC <b>${n}</b></span><span>置位 <b>${selected.join(', ')||'无'}</b></span>`;
    const start=M.integer($('bits-start').value,10,0,width-1,'字段最低位'),count=M.integer($('bits-count').value,10,1,width-start,'字段位数'),mask=((1n<<BigInt(count))-1n)<<BigInt(start);
    $('bits-field').textContent=`字段值 ${(n&mask)>>BigInt(start)} · 字段掩码 0x${mask.toString(16).toUpperCase().padStart(width/4,'0')}`;
    const operand=M.bigintInput($('bits-mask').value,16);if(operand<0||operand>limit)throw Error('掩码超出当前位宽。');
    const operation=$('bits-op').value,result=operation==='and'?n&operand:operation==='or'?n|operand:operation==='xor'?n^operand:~n&limit;
    $('bits-result').value=result.toString(16).toUpperCase().padStart(width/4,'0');
  });}
  function calcChecker(){run('checker',()=>{
    const r=M.compareFrames($('checker-request').value,$('checker-response').value,$('checker-transport').value);
    $('checker-result').innerHTML=`<p class="badge ${r.valid?'':'fail'}">${r.valid?'✓ 字段与校验一致':'× 存在不匹配或异常'}</p>`+table(['检查项目','结果','说明'],r.checks.map(c=>row([E(c.name),c.valid?'✓ 通过':'× 未通过',E(c.detail)])).join(''));
    if([3,4].includes(r.req.fc)&&!(r.res.fc&128))$('checker-result').innerHTML+=table(['寄存器偏移','HEX','UINT16','INT16'],Array.from({length:r.res.data.length/2},(_,i)=>row([i,M.hex(r.res.data.slice(i*2,i*2+2)),M.decode(r.res.data.slice(i*2,i*2+2),'UINT16'),M.decode(r.res.data.slice(i*2,i*2+2),'INT16')])).join(''));
  });}
  const calculators={converter:calcConverter,text:calcText,compare:calcCompare,bases:calcBases,address:calcAddress,bits:calcBits,checker:calcChecker};
  function route() {
    const parts=location.hash.startsWith('#/')?location.hash.slice(2).split('/'):[],requested=parts[0]==='serial'?'debug':parts[0]||'debug',tool=tools.some(t=>t[0]===requested)?requested:'debug';
    if(active!==tool){active=tool;const info=tools.find(t=>t[0]===tool);
      document.querySelector('.intro h1').textContent=['rtu','tcp','ascii'].includes(tool)?`Modbus ${tool.toUpperCase()} 报文工具`:info[1];document.querySelector('.intro p').textContent=info[2]+'。';document.title=info[1]+' · Modbus 工具箱';
      $('protocol-view').hidden=!['rtu','tcp','ascii'].includes(tool);$('extras-view').hidden=!$('protocol-view').hidden;
      document.querySelectorAll('[data-route]').forEach(a=>{a.classList.toggle('active',a.dataset.route===tool);a.setAttribute('aria-current',a.dataset.route===tool?'page':'false');});$('mobile-tool').value=tool;
      if(!$('protocol-view').hidden){window.ProtocolApp.setTransport(tool);document.querySelectorAll('.tool-nav a').forEach(a=>{const target=a.getAttribute('href').split('/').pop().replace('#','');a.href=`#/${tool}/${target}`;a.hidden=tool==='tcp'&&target==='crc';});}
      else {if(!views.has(tool)){const view=document.createElement('div');view.id='view-'+tool;view.innerHTML=viewHTML(tool);$('extras-view').append(view);views.set(tool,view);if(calculators[tool])calculators[tool]();}views.forEach((view,key)=>{view.hidden=key!==tool;});}
      document.dispatchEvent(new CustomEvent('toolchange',{detail:{tool}}));
    }
    if(parts[1]&&$(parts[1]))$(parts[1]).scrollIntoView({behavior:'instant',block:'start'});else window.scrollTo({top:0,behavior:'instant'});
  }
  $('mobile-tool').addEventListener('change',event=>{location.hash='#/'+event.target.value;});window.addEventListener('hashchange',route);
  $('extras-view').addEventListener('input',event=>{if(calculators[active]&&event.target.tagName!=='BUTTON')calculators[active]();});
  $('extras-view').addEventListener('click',event=>{const el=event.target.closest('button');if(!el)return;
    if(el.dataset.bit!==undefined){run('bits',()=>{const n=M.bigintInput($('bits-value').value,Number($('bits-base').value))^(1n<<BigInt(el.dataset.bit));$('bits-value').value=n.toString(Number($('bits-base').value)).toUpperCase();calcBits();});}
    if(el.id==='convert-batch')calcBatch();if(el.id==='export-batch'){calcBatch();download('data-conversion.csv',csv([['输入',...M.ORDERS],...batchRows]));}
    if(el.id==='compare-run')calcCompare();if(el.id==='checker-run')calcChecker();
  });
  function csv(rows){return '\uFEFF'+rows.map(cells=>cells.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');}
  function download(name,text){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  window.Suite={M,$,E,input,select,opts,card,err,table,row,typeOptions,orderOptions,run,csv,download,navigate(tool){location.hash='#/'+tool;route();},get active(){return active;}};
  route();
})();
