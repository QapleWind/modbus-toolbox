'use strict';
(() => {
  const S=window.Suite,M=S.M,P=window.ModbusPoints,D=window.ModbusDebug,{$,E}=S;
  const exporter=window.PointExport||{},marksKey=exporter.marksKey||'modbus.marked.v2',prefsKey=exporter.prefsKey||'modbus.debug.v2';
  const pinsKey=prefsKey+'.fixed.v1';let pins,portEndpoints=new Map();try{pins=new D.PinStore(JSON.parse(localStorage.getItem(pinsKey)||'[]'));}catch(_){pins=new D.PinStore();}
  let mounted=false,link=null,connecting=false,connected=false,connection=null,pending=null,stream=null,cycle=null,transaction=0;
  let last=null,previous=null,rules=[],ruleSource=[],gridCells=[],stackCells=[],bitGroups=[],rangeKey='',selected=0,history=[],logs=[],tx=0,rx=0,polls=0,responses=0,failures=0,portErrorMessage='',marks,marksSaveTimer=null;
  const expandedBits=new Set();
  const expressionDrafts=new Map();let watchInputs=[];
  try{marks=new D.MarkStore((JSON.parse(localStorage.getItem(marksKey)??JSON.stringify(exporter.legacyMarks?.()||[]))||[]).filter(item=>!item.observed?.demo));}catch(_){marks=new D.MarkStore();}
  const f=id=>$('dbg-'+id),select=(id,label,options)=>S.select('dbg-'+id,label,options),input=(id,label,value='')=>S.input('dbg-'+id,label,value);
  const prefs=['transport','host','port','baud','bits','stop','parity','slave','fc','base','start','quantity','values','coil','type','order','mode','timeout','interval','export-device'];
  const formats=()=>S.opts([['UINT16','无符号整数'],['INT16','有符号整数'],['BIT','BIT · 寄存器位组'],['HEX','十六进制 HEX'],['BIN','二进制 BIN'],['FLOAT32','32 位浮点'],['FLOAT64','64 位浮点'],['UINT32','32 位无符号'],['INT32','32 位有符号'],['UINT64','64 位无符号'],['INT64','64 位有符号']]);
  function error(message=''){f('error').textContent=message;f('error').hidden=!message;}
  function status(text){f('status').textContent=text;}
  function saveMarks(){clearTimeout(marksSaveTimer);marksSaveTimer=null;try{localStorage.setItem(marksKey,JSON.stringify(marks.save()));}catch(_){error('本机存储空间不足，请及时导出已标记点。');}}
  function savePrefs(){if(!mounted)return;try{localStorage.setItem(prefsKey,JSON.stringify(Object.fromEntries(prefs.map(id=>[id,f(id).value]))));}catch(_){}}
  function numericType(){return ['HEX','BIN'].includes(f('type').value)?'UINT16':f('type').value;}
  function savePins(){try{localStorage.setItem(pinsKey,JSON.stringify(pins.save()));}catch(_){error('无法保存固定点，请导出配置备份。');}}

  function resolveRules(chosen=rules[selected]){rules=D.resolveLayout(last,ruleSource);const match=chosen?rules.findIndex(r=>chosen.pinKey?r.pinKey===chosen.pinKey:r.offset===chosen.offset&&(r.type==='BIT')===(chosen.type==='BIT')&&Number(r.bit??0)===Number(chosen.bit??0)):-1,owner=chosen?rules.findIndex(r=>r.type!=='BIT'&&Number(r.offset)<=Number(chosen.offset)&&Number(r.offset)+P.TYPES[r.type].words>Number(chosen.offset)):-1;selected=match>=0?match:owner>=0?owner:Math.min(selected,Math.max(0,rules.length-1));}
  function pointTypeOptions(type){return S.typeOptions(type)+`<option value="BIT" ${type==='BIT'?'selected':''}>BIT · 寄存器单个位</option>`;}
  function mixed(){return f('mode').value==='mixed';}
  function updateMode(){f('type').disabled=mixed();f('order').disabled=mixed()||Number(f('fc').value)<=2;f('pins-hint').textContent=mixed()?'已固定点独立解析，未固定地址按 UINT16 显示。':'点选地址并设置类型后，点击“固定此点”保存。';}
  function pinContext(){const transport=f('transport').value;let device=connection?.endpoint||portEndpoints.get(f('serial-port').value)||'';if(transport==='tcp'&&!connection){try{device=P.tcpDevice(f('host').value,f('port').value);}catch(_){device='';}}return {transport,device,slave:Number(f('slave').value),fc:Number(f('fc').value)};}
  function debugPlugin(method,...args){try{exporter.debugPlugin?.[method]?.(...args);}catch(e){error(e.message);}}
  function debugPluginApi(){return {
    context:()=>({...pinContext(),connected,baud:f('baud').value,parity:f('parity').value}),snapshot:()=>last,
    configureRead:config=>{
      if(pending)throw Error('请等待当前响应后再应用解析配置。');
      if(connected&&config.transport!==f('transport').value)throw Error('请先断开并切换到点表对应的连接方式。');
      const slave=P.integer(config.slave,10,config.transport==='rtu'?1:0,config.transport==='rtu'?247:255,'设备 ID'),fc=P.integer(config.fc,10,1,4,'读取功能码'),start=P.integer(config.start,10,0,65535,'起始地址'),quantity=P.integer(config.quantity,10,1,fc<=2?2000:125,'读取数量');
      if(start+quantity>65536)throw Error('读取地址超出 65535。');stopCycle();
      if(!connected){f('transport').value=config.transport;if(config.transport==='tcp'){P.tcpDevice(config.host,config.port);f('host').value=config.host;f('port').value=config.port;}else if(config.baud){if(!Array.from(f('baud').options).some(o=>o.value===String(config.baud)))f('baud').add(new Option(String(config.baud),String(config.baud)));f('baud').value=config.baud;f('parity').value=config.parity||'none';}}
      f('base').value='10';f('base').dataset.previous='10';for(const [id,value] of Object.entries({slave,fc,start,quantity}))f(id).value=String(value);updateFields();savePrefs();last=null;previous=null;rules=[];ruleSource=[];history=[];rangeKey='';renderGrid();renderPins();return {...pinContext(),connected};
    },
    isMarked:(point,expression='')=>{const item=marks.items.find(i=>i.key===D.identity(point));return !!item&&item.expression===expression;},
    toggleMarked:entry=>{const item=marks.items.find(i=>i.key===D.identity(entry.point));if(item&&item.expression!==(entry.expression||''))throw Error('同一原始点已有不同表达式的标记，请先在标记点列表中处理。');if(item)marks.remove(item.key);else marks.upsert(entry);saveMarks();renderMarks();updateValues();return !item;}
  };}
  function mount(){
    if(mounted||!$('debug-root'))return;mounted=true;document.body.classList.add('debug-view');
    $('debug-root').innerHTML=`<div class="scan-connect">
      <div class="scan-connection-line">${select('transport','连接方式',S.opts([['rtu','RTU · 串口'],['tcp','TCP · 网络']]))}
      <div id="dbg-serial-settings" class="scan-serial">${select('serial-port','串口设备','<option value="">未发现串口</option>')}${select('baud','波特率',S.opts([9600,19200,38400,57600,115200,4800,2400,1200].map(v=>[v,v])))}${select('bits','数据位',S.opts([[8,'8'],[7,'7']]))}${select('parity','校验',S.opts([['none','无'],['even','偶'],['odd','奇']]))}${select('stop','停止位',S.opts([[1,'1'],[2,'2']]))}<button id="dbg-refresh" class="button">刷新</button><button id="dbg-grant" class="button" hidden>授权串口</button></div>
      <div id="dbg-tcp-settings" class="scan-tcp" hidden><label>设备 IPv4<input id="dbg-host" placeholder="192.0.2.10" autocomplete="off"></label>${input('port','端口','502')}</div>
      <button id="dbg-connect" class="button primary">连接</button></div><div class="scan-status"><i id="dbg-led"></i><span id="dbg-status">选择设备后连接。</span><span id="dbg-pending"></span></div><p id="dbg-error" class="error" role="alert" hidden></p>
    </div>
    <div class="scan-workbench">
      <div class="scan-parameters">${input('slave','设备 ID（DEC）','1')}${select('fc','数据区 / 功能码',Object.entries(M.FUNCTIONS).map(([fc,label])=>`<option value="${fc}" ${fc==='3'?'selected':''}>${Number(fc).toString(16).toUpperCase().padStart(2,'0')} · ${label}</option>`).join(''))}${select('base','地址进制',S.opts([[10,'DEC'],[16,'HEX']]))}${input('start','起始协议地址','0')}${input('quantity','长度 / 写入值','16')}${select('coil','线圈状态',S.opts([['1','ON · FF00'],['0','OFF · 0000']]))}${select('type','显示格式',formats())}${select('order','字节序',S.orderOptions())}</div>
      <label id="dbg-values-wrap" class="spaced" hidden>多点写入值<input id="dbg-values" class="mono" value=""></label>
      <div class="scan-actions"><button id="dbg-cycle" class="button primary" disabled>开始扫描</button><button id="dbg-send" class="button" disabled>读取一次</button><label>周期 ms<input id="dbg-interval" type="number" min="100" value="1000"></label><label>超时 ms<input id="dbg-timeout" type="number" min="100" value="2000"></label><div class="scan-counters"><span>请求 <b id="dbg-polls">0</b></span><span>有效 <b id="dbg-responses">0</b></span><span>失败 <b id="dbg-failures">0</b></span></div></div>
      <div class="scan-fixed-toolbar">${select('mode','解析方式',S.opts([['uniform','统一格式'],['mixed','固定混合']]))}<span id="dbg-pins-hint" class="helper"></span><button id="dbg-mark-pins" class="button" disabled>标记固定点</button><button id="dbg-pins-range" class="button">带入固定范围</button></div>
      <div class="scan-monitor-head"><div><strong>模块视图</strong><span id="dbg-source">等待有效响应</span></div><div class="actions"><button id="dbg-fold-bits" class="button" hidden>收起全部位组</button><button id="dbg-mark-all" class="button" disabled>标记全部</button><button id="dbg-export-top" class="button primary" disabled>导出已标记点（0）</button></div></div>
      <div id="dbg-grid-content" class="scan-content"><div class="scan-grid-wrap"><div class="scan-width-key"><span>4 个 bit = 1 个 16 位寄存器模块</span><span>32 位 = 2 个模块</span><span>按地址自动换行</span></div><div id="dbg-grid" class="scan-grid scan-address-grid" role="group" aria-label="寄存器和位点直接混排"></div><div class="scan-caption">点击 BIT 模块展开寄存器位组，右上角可收起。01/02 每个地址为独立位块。黄色表示数值变化。</div></div>
      <aside class="scan-point-panel"><div class="scan-point-heading">选中点 <b id="dbg-selected-address">—</b></div><p id="dbg-point-empty">连接后读取，再点击一个点查看或编辑。</p><div id="dbg-point-fields" hidden>
        <div class="scan-selected-value" id="dbg-selected-value">—</div><div id="dbg-point-origin" class="helper"></div>
        ${input('point-name','点名')}${select('point-type','数据类型',pointTypeOptions('UINT16'))}${input('point-bit','位号（0 为最低位）','0')}${select('point-order','点字节序',S.orderOptions())}<div class="two-grid">${input('point-factor','系数','1')}${input('point-constant','常数','0')}</div>
        <div class="scan-raw"><span>原始字节</span><code id="dbg-selected-bytes">—</code></div><button id="dbg-pin-selected" class="button primary" disabled>固定此点</button><button id="dbg-add-pin-bit" class="button" hidden>新增同寄存器位</button><button id="dbg-mark-selected" class="button" disabled>☆ 标记此点</button>
      </div></aside></div>
    </div>
    <details class="scan-section" id="dbg-watch-details"><summary><span>标记点列表</span><b id="dbg-mark-count">0 个点</b></summary><div id="dbg-list-content" class="scan-list-content"><div class="pt-toolbar"><label class="scan-export-device">${E(exporter.deviceLabel||'随后标记的设备地址')}<input id="dbg-export-device" placeholder="${E(exporter.devicePlaceholder||'连接后自动带入')}"></label><div class="actions"><button id="dbg-export-marks" class="button primary">导出所有标记</button><button id="dbg-clear-marks" class="button">清空标记</button></div></div><p class="scan-expression-help">${E(exporter.hint||'导出点名、设备地址、ID、功能码、协议地址、数据类型、倍率和表达式。')}</p><div class="scan-list-toolbar"><span>仅显示已标记点；v 为倍率换算后的值，raw 为倍率前的原始值。</span><button id="dbg-export-watch" class="button">导出列表配置</button><button id="dbg-import-watch" class="button">导入列表配置</button><input id="dbg-watch-file" type="file" accept=".json,application/json" hidden></div><p class="scan-expression-help">表达式示例：<code>"true" if v != 0 else "false"</code>、<code>v * 0.1</code>、<code>"运行" if v else "停止"</code>。表达式随列表配置和 CSV 保存。</p><div id="dbg-watch"></div></div></details>
    <details class="scan-section" id="dbg-raw-details"><summary><span>原始报文</span><span id="dbg-byte-count">TX 0 · RX 0 字节</span></summary><div class="scan-section-body"><label>当前请求<input id="dbg-request" class="mono output" readonly></label><div class="actions spaced"><button id="dbg-export-log" class="button">导出日志</button><button id="dbg-clear-log" class="button">清空日志</button></div><div id="dbg-log" class="serial-terminal spaced" role="log" aria-label="Modbus 收发日志"></div></div></details>
    <details class="scan-section" id="dbg-pins-details"><summary><span>固定点配置</span><b id="dbg-pin-count">0 个点</b></summary><div class="scan-section-body"><div class="pt-toolbar"><p class="helper">按连接地址、设备 ID 和数据区保存；固定与标记独立。BIT 从当前字节序解析后的 16 位值提取。</p><div class="actions"><button id="dbg-export-pins" class="button">导出配置</button><button id="dbg-import-pins" class="button">导入配置</button><input id="dbg-pins-file" type="file" accept=".json,application/json" hidden></div></div><div id="dbg-pinned" class="spaced"></div></div></details>
    <details class="scan-section" id="dbg-history-details"><summary>采集曲线与记录</summary><div class="scan-section-body"><div id="dbg-legend" class="serial-chart-legend"></div><canvas id="dbg-chart" class="serial-chart" height="440" width="1500" aria-label="Modbus 点值曲线"></canvas><button id="dbg-export-data" class="button spaced">导出采集 CSV</button><div id="dbg-history" class="spaced"></div></div></details>`;
    try{const saved=JSON.parse(localStorage.getItem(prefsKey));for(const id of prefs){const el=f(id),v=saved?.[id];if(typeof v==='string'&&v.length<=256&&(el.tagName!=='SELECT'||Array.from(el.options).some(o=>o.value===v)))el.value=v;}}catch(_){}
    f('base').dataset.previous=f('base').value;updateFields();refreshPorts();renderGrid();renderMarks();renderPins();saveMarks();
    f('watch-details').addEventListener('toggle',()=>{if(f('watch-details').open)updateWatchValues();});
    f('history-details').addEventListener('toggle',renderHistory);
    debugPlugin('mount',debugPluginApi());
  }
  function conf(){return Object.fromEntries(['transport','base','slave','fc','start','quantity','coil','values'].map(id=>[id,f(id).value]));}
  function updateFields(){
    const tcp=f('transport').value==='tcp',fc=Number(f('fc').value),bit=fc<=2,old=f('type').value;
    f('serial-settings').hidden=tcp;f('tcp-settings').hidden=!tcp;
    f('coil').parentElement.hidden=fc!==5;f('quantity').parentElement.hidden=[5,15,16].includes(fc);f('values-wrap').hidden=![15,16].includes(fc);
    f('type').innerHTML=bit?'<option>BOOL</option>':formats();if(!bit&&old!=='BOOL')f('type').value=old;f('order').disabled=bit;
    f('send').textContent=fc<=4?'读取一次':'发送写入';updateMode();preview();
  }
  function preview(){try{f('request').value=M.hex(D.request(conf(),{},1).bytes);}catch(_){f('request').value='';}}
  async function refreshPorts(){try{
    const old=f('serial-port').value,ports=await window.DeviceClient.ports();
    portEndpoints=new Map(ports.map(p=>[p.id,p.endpoint]));
    const signature=JSON.stringify(ports);if(f('serial-port').dataset.ports!==signature){f('serial-port').dataset.ports=signature;f('serial-port').innerHTML='<option value="">'+(ports.length?'请选择串口':'未发现串口')+'</option>'+ports.map(p=>`<option value="${E(p.id)}">${E(p.name)}</option>`).join('');}
    if(ports.some(p=>p.id===old))f('serial-port').value=old;f('grant').hidden=!window.DeviceClient.needsGrant();if(portErrorMessage&&f('error').textContent===portErrorMessage)error();portErrorMessage='';
  }catch(e){portErrorMessage=e.message;error(e.message);}}
  function log(kind,bytes,message){logs.push({time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),kind,hex:bytes?M.hex(bytes):'',message:message||''});logs=logs.slice(-500);f('log').innerHTML=logs.map(l=>`<div class="${l.kind.toLowerCase()}">${E(l.time)} ${l.kind} ${E(l.message||l.hex)}</div>`).join('');f('log').scrollTop=f('log').scrollHeight;f('byte-count').textContent=`TX ${tx} · RX ${rx} 字节`;}
  function stats(){f('polls').textContent=polls;f('responses').textContent=responses;f('failures').textContent=failures;}
  function connectionUI(){
    for(const id of ['transport','serial-port','baud','bits','stop','parity','host','port','refresh','grant'])f(id).disabled=connected||connecting;
    f('connect').disabled=connecting;f('connect').textContent=connecting?'连接中…':connected?'断开':'连接';
    f('send').disabled=!connected||!!pending;f('cycle').disabled=!connected;f('pending').textContent=pending?'等待响应…':'';f('led').classList.toggle('online',connected);
  }
  function stopCycle(){clearInterval(cycle);cycle=null;f('cycle').textContent='开始扫描';f('cycle').classList.remove('scanning');}
  function clearPending(){if(pending)clearTimeout(pending.timer);pending=null;connectionUI();}
  async function disconnect(message='已断开连接。'){
    stopCycle();clearPending();connected=false;connecting=false;const old=link;link=null;await old?.close();stream?.clear();connection=null;connectionUI();status(message);log('SYS',null,message);
  }
  async function connect(){
    if(connected)return disconnect();if(connecting)return;error();connecting=true;connectionUI();last=null;previous=null;history=[];rules=[];rangeKey='';renderGrid();
    try{
      const transport=f('transport').value;link=new window.DeviceClient.Link(receive,message=>{if(connected)disconnect(message);});
      if(transport==='tcp'){
        const host=f('host').value.trim(),port=P.integer(f('port').value,10,1,65535,'TCP 端口');P.tcpDevice(host,port);
        await link.tcp({host,port});connection={transport,endpoint:host+':'+port,device:host+':'+port};
      }else{
        await link.serial({port:f('serial-port').value,baud:Number(f('baud').value),bits:Number(f('bits').value),stop:Number(f('stop').value),parity:f('parity').value});
        connection={transport,endpoint:link.endpoint,device:link.endpoint};
      }
      if(link.closed)throw Error('连接已关闭。');f('export-device').value=exporter.deviceFor?.({...connection,baud:f('baud').value,parity:f('parity').value})??connection.device;stream=new D.FrameStream(transport);connected=true;status('已连接 '+connection.endpoint);log('SYS',null,'已连接 '+connection.endpoint);savePrefs();
    }catch(e){await link?.close();link=null;connected=false;connection=null;error(e.name==='NotFoundError'?'串口已不可用，请刷新列表后重试。':e.message);}
    finally{connecting=false;connectionUI();}
  }
  async function send(){
    if(!connected||pending)return;error();
    try{
      const timeout=P.integer(f('timeout').value,10,100,30000,'响应超时'),req=D.request(conf(),connection,transaction=(transaction+1)&65535);
      stream.clear();pending={req,timer:null};connectionUI();polls++;stats();
      pending.timer=setTimeout(()=>{if(pending?.req!==req)return;clearPending();stopCycle();failures++;stats();status('响应超时，保留上次有效数据。');log('SYS',null,'请求超时');},timeout);
      tx+=req.bytes.length;log('TX',req.bytes);await link.send(Uint8Array.from(req.bytes));
    }catch(e){if(pending){failures++;stats();}clearPending();stopCycle();error(e.message);}
  }
  function receive(bytes){
    if(!stream||!connected)return;rx+=bytes.length;log('RX',bytes);
    for(const packet of stream.push(bytes)){
      if(!pending){log('SYS',null,'未关联当前请求的响应，仅记录报文');continue;}
      const result=D.match(pending.req,packet);
      if(result.kind==='ignore'){log('SYS',null,'忽略不匹配响应：'+result.reason);continue;}
      const req=pending.req;clearPending();
      if(result.kind==='exception'){failures++;stats();stopCycle();error('设备异常：'+result.reason);continue;}
      responses++;stats();if(result.kind==='write'){status('写入确认：'+req.source.endpoint);continue;}
      previous=last;last=result.record;if(marks.observe(last)&&!marksSaveTimer)marksSaveTimer=setTimeout(saveMarks,500);const key=JSON.stringify([req.transport,req.source.endpoint,req.slave,req.fc,req.start,req.quantity]);
      if(key!==rangeKey){rangeKey=key;previous=null;history=[];selected=0;rebuild();}else updateValues();
      history.push(last);history=history.slice(-200);renderHistory();status('已连接 '+req.source.endpoint+' · 扫描正常');debugPlugin('observe',last);
    }
  }
  function rebuild(keepEditor=false,chosen=rules[selected]){try{ruleSource=(mixed()?D.mixedLayout(last,pins):D.layout(last,numericType(),f('order').value)).filter(r=>!r.expanded);resolveRules(chosen);}catch(e){rules=[];ruleSource=[];error(e.message);}renderGrid(keepEditor);renderPins();}
  function entry(rule){return D.mark(last,rule,f('export-device').value.trim());}
  function ref(address){const q=last.request;return D.referenceAddress(q.fc,address,q.start+q.quantity>9999?6:5);}
  function renderGrid(keepEditor=false){
    const available=f('grid').clientWidth||960,columns=Math.max(4,Math.min(24,Math.floor((available+6)/60/4)*4));
    bitGroups=[];
    const pointCell=(i,span=1)=>{
      const r=rules[i],bit=['BOOL','BIT'].includes(r.type),address=last.request.start+Number(r.offset),label=ref(address)+(r.type==='BIT'?'.'+r.bit:''),scale=D.scaleLabel(r),end=address+P.TYPES[r.type].words-1,range=!bit&&end!==address?' – '+ref(end):'';
      return `<div class="scan-cell${bit?' bit-point':''}${r.pinKey?' pinned':''}" data-point-index="${i}" style="grid-column:span ${span}"><button class="scan-cell-select" data-select-point="${i}" aria-label="查看 ${E(label)} ${E(r.type)}"><span class="scan-cell-address">${label}${range}</span><strong>—</strong><small>${bit?r.type:E(r.name)+' · '+r.type}</small><span class="scan-cell-scale" ${scale?'':'hidden'}>${E(scale)}</span></button><button data-mark-point="${i}" class="scan-star" aria-label="标记 ${E(label)}">☆</button></div>`;
    };
    const cells=()=>{const map=D.monitorLayout(last,rules,columns,expandedBits);bitGroups=map.groups;return `<div class="scan-flow-grid" style="--scan-columns:${map.columns}">${map.items.map(item=>{
      if(item.kind==='point')return pointCell(item.index,item.span);
      const group=map.groups.find(g=>g.key===item.key),label=ref(group.address);
      if(item.kind==='group')return `<section class="scan-bit-group" role="group" aria-label="${label} 寄存器位组" style="grid-column:span ${item.span}"><button class="scan-bit-group-fold" data-collapse-bit="${E(item.key)}" aria-label="收起 ${label} 的 16 个位" title="收起" aria-expanded="true">×</button><div class="scan-bit-grid" style="--bit-columns:${item.span}">${group.indices.map(i=>pointCell(i)).join('')}</div></section>`;
      return `<div class="scan-cell scan-bit-deck" data-bit-stack="${E(item.key)}" style="grid-column:span 4"><button class="scan-deck-open" data-expand-bit="${E(item.key)}" aria-label="展开 ${label} 的 16 个位" aria-expanded="false"><span class="scan-deck-heading"><b>${label}</b><em>展开 ▾</em></span><small class="scan-deck-summary">16 位</small><span class="scan-deck-fan" aria-hidden="true">${group.indices.map((n,j)=>`<span class="scan-deck-card" data-deck-point="${n}" style="--card:${j}"><i>${rules[n].bit}</i><strong>—</strong><span class="scan-deck-mark"></span></span>`).join('')}</span></button></div>`;
    }).join('')}</div>`;};
    f('grid').innerHTML=!last?'<div class="scan-empty"><span>等待设备数据</span><p>连接设备后点击“读取一次”或“开始扫描”。</p></div>':!rules.length?'<div class="scan-empty">读取长度无法按当前类型完整拆分，请调整显示格式或长度。</div>':cells();
    gridCells=rules.map(()=>[]);f('grid').querySelectorAll('[data-point-index]').forEach(el=>gridCells[Number(el.dataset.pointIndex)].push(el));
    stackCells=Array.from(f('grid').querySelectorAll('[data-bit-stack]')).map(el=>({el,group:bitGroups.find(g=>g.key===el.dataset.bitStack)}));f('fold-bits').hidden=!bitGroups.length;f('fold-bits').textContent=bitGroups.every(g=>expandedBits.has(g.key))?'收起全部位组':'展开全部位组';
    f('mark-all').disabled=!last||!rules.length;updateValues();if(!keepEditor)renderSelected();
  }
  function updateValues(){
    if(!last){f('source').textContent='等待有效响应';renderSelected();updatePinValues();return;}
    const q=last.request;f('source').textContent=`${q.source.endpoint} · ID ${q.slave} · FC ${String(q.fc).padStart(2,'0')} · 协议 ${q.start}–${q.start+q.quantity-1} · ${new Date(last.receivedAt).toLocaleTimeString('zh-CN',{hour12:false})}`;
    rules.forEach((r,i)=>{
      const cells=gridCells[i]||[];if(!cells.length)return;
      try{
        const v=D.view(last,r),bit=['BOOL','BIT'].includes(r.type),value=bit?v.raw:D.displayValue(last,r,mixed()?'MIXED':f('type').value);
        let changed=false;try{changed=!!previous&&D.view(previous,r).value!==v.value;}catch(_){}
        for(const cell of cells){cell.querySelector('strong').textContent=value;cell.title=`${ref(v.address)}${r.type==='BIT'?'.'+r.bit:''} · ${r.name} · ${r.type} · 值 ${v.value}${bit?' · 原始位 '+v.raw:''}`;cell.classList.toggle('changed',changed);cell.classList.toggle('selected',i===selected);cell.classList.toggle('bit-on',bit&&v.raw==='1');const badge=cell.querySelector('.scan-cell-scale');badge.textContent=D.scaleLabel(r);badge.hidden=!badge.textContent;
          const star=cell.querySelector('.scan-star');try{const on=marks.has(entry(r).point);star.disabled=false;star.textContent=on?'★':'☆';star.classList.toggle('marked',on);cell.classList.toggle('marked',on);star.setAttribute('aria-pressed',String(on));star.title=on?'取消标记':'标记此点';}catch(e){star.disabled=true;star.title=e.message;}
        }
      }catch(e){for(const cell of cells){cell.querySelector('strong').textContent='—';cell.title=e.message;cell.querySelector('.scan-star').disabled=true;cell.classList.toggle('selected',i===selected);}}
    });
    updateStacks();updateSelectedValue();updatePinValues();updateWatchValues();
  }
  function updateStacks(){for(const {el,group} of stackCells){let on=0,marked=0,changed=false,valid=true;for(const chip of el.querySelectorAll('[data-deck-point]')){const r=rules[Number(chip.dataset.deckPoint)];try{const v=D.view(last,r),active=v.raw==='1';on+=Number(active);chip.querySelector('strong').textContent=v.raw;chip.classList.toggle('on',active);let isMarked=false;try{isMarked=marks.has(entry(r).point);}catch(_){}marked+=Number(isMarked);chip.classList.toggle('marked',isMarked);chip.querySelector('.scan-deck-mark').textContent=isMarked?'★':'';try{if(previous&&D.view(previous,r).raw!==v.raw)changed=true;}catch(_){}}catch(_){valid=false;chip.querySelector('strong').textContent='—';chip.classList.remove('on','marked');}}
    el.querySelector('.scan-deck-summary').textContent=valid?`${on}/16 置位${marked?' · 标记 '+marked:''}`:'本次读取未覆盖';el.title=`${ref(group.address)}.0–15 · 点击展开 16 个位`;el.classList.toggle('selected',group.indices.includes(selected));el.classList.toggle('changed',changed);el.classList.toggle('pinned',group.indices.some(i=>rules[i].pinKey));}}
  function renderSelected(){
    const rule=rules[selected],active=!!last&&!!rule;f('point-fields').hidden=!active;f('point-empty').hidden=active;f('selected-address').textContent=active?ref(last.request.start+Number(rule.offset))+(rule.type==='BIT'?'.'+rule.bit:''):'—';
    if(!active)return;
    for(const key of ['name','factor','constant'])f('point-'+key).value=rule[key];
    f('point-type').innerHTML=last.request.fc<=2?'<option>BOOL</option>':pointTypeOptions(rule.type);f('point-bit').value=rule.bit??0;f('point-bit').parentElement.hidden=rule.type!=='BIT';f('point-order').value=rule.order;f('point-order').disabled=rule.type==='BOOL';
    updateSelectedValue();
  }
  function updateSelectedValue(){
    const rule=rules[selected];if(!last||!rule)return;
    f('selected-address').textContent=ref(last.request.start+Number(rule.offset))+(rule.type==='BIT'?'.'+rule.bit:'');f('pin-selected').textContent=rule.pinKey?'取消固定':'固定此点';f('point-bit').parentElement.hidden=rule.type!=='BIT';f('pin-selected').disabled=false;f('add-pin-bit').hidden=rule.type!=='BIT'||!rule.pinKey;
    try{const v=D.view(last,rule);f('selected-value').textContent=D.formatDisplay(v.value);f('selected-bytes').textContent=v.bytes;f('point-origin').textContent=`协议地址 ${v.address} / 0x${v.address.toString(16).toUpperCase().padStart(4,'0')} · 偏移 ${rule.offset}`;
      try{const on=marks.has(entry(rule).point);f('mark-selected').textContent=on?'★ 已标记，点击取消':'☆ 标记此点';f('mark-selected').disabled=false;f('mark-selected').title='';}catch(e){f('mark-selected').disabled=true;f('mark-selected').title=e.message;}
    }catch(e){f('selected-value').textContent='—';f('selected-bytes').textContent=e.message;f('mark-selected').disabled=true;f('pin-selected').disabled=!rule.pinKey;}
  }
  function renderPins(){
    if(!mounted)return;f('pin-count').textContent=pins.items.length+' 个点';f('export-pins').disabled=!pins.items.length;
    f('pinned').innerHTML=!pins.items.length?'<div class="empty-state">读取数据后，点选地址设置类型，再点击“固定此点”。</div>':S.table(['点名','设备 / ID / FC','协议地址','解析方式','系数 / 常数','最近有效值','操作'],pins.items.map((p,i)=>S.row([E(p.name),`${E(p.device)}<small>${p.transport.toUpperCase()} · ${p.slave} · ${String(p.fc).padStart(2,'0')}</small>`,p.address,`${p.type}${p.type==='BIT'?' · 位 '+p.bit:''}<small>${p.order} · ${P.TYPES[p.type].words} 地址</small>`,`${E(p.factor)} / ${E(p.constant)}`,`<span id="dbg-pin-value-${i}">—</span>`,`<button class="button" data-mark-pin="${i}" disabled>标记</button> <button class="button" data-remove-pin="${i}">取消固定</button>`])).join(''));
    updatePinValues();
  }
  function matchesPin(p){if(!last)return false;const r=last.request;return p.transport===r.transport&&p.device===r.source.endpoint&&p.slave===r.slave&&p.fc===r.fc;}
  function updatePinValues(){
    if(!mounted)return;let readable=0;
    pins.items.forEach((p,i)=>{const cell=f('pin-value-'+i),button=document.querySelector(`[data-mark-pin="${i}"]`);if(!cell||!button)return;button.disabled=true;
      if(!matchesPin(p)){cell.textContent='未读取此设备 / 数据区';return;}
      try{const rule=D.pinRule(p,last),v=D.view(last,rule);cell.textContent=D.formatDisplay(v.value);cell.title=last.receivedAt;readable++;try{entry(rule);button.disabled=false;}catch(e){button.title=e.message;}}catch(e){cell.textContent='本次读取未覆盖';cell.title=e.message;}
    });f('mark-pins').disabled=!readable;
  }
  function renderMarks(){
    f('export-top').textContent=`导出已标记点（${marks.items.length}）`;f('export-top').disabled=!marks.items.length;f('mark-count').textContent=marks.items.length+' 个点';
    f('export-marks').disabled=!marks.items.length;f('clear-marks').disabled=!marks.items.length;
    renderWatch();
  }
  function renderWatch(){
    f('export-watch').disabled=!marks.items.length;
    f('watch').innerHTML=!marks.items.length?'<div class="scan-empty"><span>尚无标记点</span><p>先在模块视图中点击 ☆，标记点会出现在这里。</p></div>':S.table(['点名 / 来源','地址 / 类型','采集值','表达式','显示结果','最近读取','操作'],marks.items.map((item,i)=>{const p=item.point,expression=expressionDrafts.get(item.key)??item.expression??'';
      return S.row([`<input data-mark-name="${i}" aria-label="列表点 ${i+1} 点名" value="${E(p.name)}"><small title="${E(p.device)}">${E(item.observed.endpoint||p.device)} · ID ${p.slave} · FC ${String(p.fc).padStart(2,'0')}</small>`,`<code>${D.referenceAddress(p.fc,p.address)}${p.type==='BIT'?'.'+p.bit:''}</code><small>${p.type} · 协议 ${p.address}${p.type==='BIT'?' / 位 '+p.bit:''}</small>`,`<b id="dbg-watch-value-${i}">—</b><small>${E(D.scaleLabel(p)||'×1')}</small>`,`<div class="scan-expression-row"><input class="mono" data-watch-expression="${i}" aria-label="点 ${i+1} 表达式" placeholder="例如 v != 0" value="${E(expression)}"><button class="button" data-apply-expression="${i}">应用</button></div><div class="scan-expression-row"><select data-expression-preset="${i}" aria-label="点 ${i+1} 表达式预设"><option value="">快捷表达式…</option><option value="text">true / false 文本</option><option value="boolean">布尔值 true / false</option><option value="state">运行 / 停止</option><option value="clear">恢复采集值</option></select><small id="dbg-watch-message-${i}"></small></div>`,`<strong id="dbg-watch-result-${i}" class="scan-watch-result">—</strong>`,`<span id="dbg-watch-time-${i}">—</span><small id="dbg-watch-status-${i}"></small>`,`<button class="icon-button" data-unmark="${i}" aria-label="从列表取消标记 ${i+1}">×</button>`]);
    }).join(''));watchInputs=Array.from(f('watch').querySelectorAll('[data-watch-expression]'));updateWatchValues();
  }
  function updateWatchValues(){
    if(!mounted||!f('watch'))return;
    marks.items.forEach((item,i)=>{const value=f('watch-value-'+i),result=f('watch-result-'+i),message=f('watch-message-'+i),input=watchInputs[i];if(!value)return;const observed=item.observed,expression=expressionDrafts.get(item.key)??item.expression??'',draft=expression!==item.expression;
      value.textContent=observed.value?D.formatDisplay(observed.value):'—';const time=new Date(observed.time);f('watch-time-'+i).textContent=Number.isFinite(time.getTime())?time.toLocaleTimeString('zh-CN',{hour12:false}):'—';f('watch-status-'+i).textContent=last&&observed.time===last.receivedAt&&observed.endpoint===last.request.source.endpoint?'本次读取':'上次读值';
      try{const compiled=D.parseExpression(expression);input.setAttribute('aria-invalid','false');if(!observed.value){result.textContent='—';message.textContent=draft?'待应用':'';return;}const evaluated=D.evaluateExpression(compiled,{v:observed.value,raw:observed.raw});result.textContent=D.formatDisplay(evaluated);result.dataset.state=['true','false'].includes(String(evaluated))?String(evaluated):'';result.classList.remove('expression-error');message.textContent=draft?'待应用':expression?'已应用':'';message.classList.remove('expression-error');}
      catch(err){result.textContent='—';result.classList.add('expression-error');message.textContent=err.message;message.classList.add('expression-error');input.setAttribute('aria-invalid','true');}
    });
  }
  function applyExpression(index,text){const item=marks.items[index];if(!item)throw Error('标记不存在。');marks.setExpression(item.key,text);error();expressionDrafts.delete(item.key);saveMarks();renderWatch();}
  function assertExpressionsApplied(){if(marks.items.some(item=>expressionDrafts.has(item.key)&&expressionDrafts.get(item.key)!==item.expression))throw Error('列表表达式尚未应用，请点击对应行的“应用”后再导出。');}
  function renderHistory(){if(!last||!f('history-details').open)return;const visible=rules.slice(0,32);f('history').innerHTML=S.table(['时间',...visible.map(r=>E(r.name))],history.slice(-30).map(record=>S.row([E(new Date(record.receivedAt).toLocaleTimeString()),...visible.map(r=>{try{return E(D.view(record,r).value);}catch(_){return '—';}})])).join(''));drawChart();}
  function drawChart(){
    if(!mounted||!f('history-details').open)return;const canvas=f('chart');if(!canvas.clientWidth)return;canvas.width=Math.max(600,canvas.clientWidth*2);const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,colors=['#3978cf','#24a488','#d49a39','#a773c8','#d36d6d'];ctx.clearRect(0,0,w,h);
    const visible=rules.slice(0,32),series=visible.map(r=>history.map(record=>{try{return Number(D.view(record,r).value);}catch(_){return NaN;}})),nums=series.flat().filter(Number.isFinite);let min=nums.length?Math.min(...nums):0,max=nums.length?Math.max(...nums):1;if(min===max){min-=1;max+=1;}ctx.font='20px sans-serif';ctx.textAlign='right';for(let i=0;i<5;i++){const y=25+i*85;ctx.strokeStyle='#e5ecf7';ctx.beginPath();ctx.moveTo(110,y);ctx.lineTo(w-25,y);ctx.stroke();ctx.fillStyle='#8b9db5';ctx.fillText(Number((max-(max-min)*i/4).toPrecision(5)).toString(),100,y+7);}series.forEach((values,i)=>{ctx.strokeStyle=colors[i%colors.length];ctx.lineWidth=3;ctx.beginPath();let started=false;values.forEach((v,j)=>{if(!Number.isFinite(v)){started=false;return;}const x=110+j*(w-135)/Math.max(1,values.length-1),y=365-(v-min)/(max-min)*340;if(started)ctx.lineTo(x,y);else ctx.moveTo(x,y);started=true;});ctx.stroke();});f('legend').textContent=visible.map(r=>r.name).join(' · ');
  }
  function toggleMark(index){const en=entry(rules[index]);if(marks.has(en.point))marks.remove(D.identity(en.point));else marks.upsert(en);saveMarks();renderMarks();updateValues();}
  document.addEventListener('toolchange',e=>{document.body.classList.toggle('debug-view',e.detail.tool==='debug');if(e.detail.tool==='debug')mount();});
  document.addEventListener('input',e=>{
    if(!mounted||!e.target.closest('#debug-root'))return;const el=e.target;
    if(el.dataset.watchExpression!==undefined){const item=marks.items[Number(el.dataset.watchExpression)];if(item){expressionDrafts.set(item.key,el.value);updateWatchValues();}return;}
    if(el.id.startsWith('dbg-point-')&&rules[selected]){const key=el.id.slice(10);if(['name','type','bit','order','factor','constant'].includes(key)){const rule=rules[selected];try{error();if(key==='bit')P.integer(el.value,10,0,15,'位号');if(!ruleSource.includes(rule))ruleSource.push(rule);rule.expanded=false;rule[key]=el.value;if(rule.type==='BIT'&&rule.bit===undefined)rule.bit='0';if(rule.pinKey){rule.pinKey=pins.update(rule.pinKey,{[key]:el.value,...(rule.type==='BIT'?{bit:rule.bit}:{})});savePins();rebuild(true,rule);}else if(['type','bit'].includes(key)){resolveRules(rule);renderGrid(true);}else if(key==='name')renderGrid(true);else updateValues();renderHistory();}catch(err){error(err.message);updateValues();}}return;}
    if(el.id==='dbg-transport'&&!connected){last=null;previous=null;rules=[];rangeKey='';renderGrid();updateFields();}
    else if(el.id==='dbg-fc')updateFields();else if(el.id==='dbg-mode'){updateMode();if(last)rebuild();}else if(['dbg-type','dbg-order'].includes(el.id)&&last)rebuild();
    if(el.id==='dbg-export-device')updateValues();preview();savePrefs();
  });
  document.addEventListener('change',async e=>{
    if(e.target.dataset.expressionPreset!==undefined){const value=e.target.value,presets={text:'"true" if v != 0 else "false"',boolean:'v != 0',state:'"运行" if v else "停止"',clear:''};if(Object.hasOwn(presets,value)){try{applyExpression(Number(e.target.dataset.expressionPreset),presets[value]);}catch(err){error(err.message);}}return;}
    if(e.target.id==='dbg-watch-file'){try{const file=e.target.files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('列表配置不能超过 16 MB。');const data=JSON.parse(await file.text());if(data.schema!=='modbus-marked-points'||data.version!==1||!Array.isArray(data.items)||!data.items.length||data.items.length>5000)throw Error('列表配置格式无效。');const imported=new D.MarkStore(data.items);if(imported.dropped)throw Error('配置含无效点或表达式，已保留原配置。');const combined=new D.MarkStore(marks.save());for(const item of imported.save())combined.upsert(item);marks=combined;expressionDrafts.clear();saveMarks();renderMarks();f('watch-details').open=true;savePrefs();status('已导入 '+imported.items.length+' 个标记点与表达式。');}catch(err){error(err.message);}finally{e.target.value='';}return;}
    if(e.target.id==='dbg-pins-file'){try{const file=e.target.files[0];if(!file)return;if(file.size>512*1024)throw Error('固定点配置文件不能超过 512 KB。');const data=JSON.parse(await file.text());if(data.schema!=='modbus-fixed-points'||data.version!==1||!Array.isArray(data.points)||!data.points.length||data.points.length>1000)throw Error('固定点配置格式无效。');const imported=new D.PinStore(data.points);if(imported.dropped)throw Error('配置包含无效固定点，已保留原配置。');const combined=new D.PinStore(pins.save());for(const p of imported.items)combined.put(p);pins=combined;savePins();f('mode').value='mixed';updateMode();savePrefs();if(last)rebuild();else renderPins();f('pins-details').open=true;status('已导入 '+imported.items.length+' 个固定点配置。');}catch(err){error(err.message);}finally{e.target.value='';}return;}
    if(e.target.id==='dbg-base'){try{const old=Number(f('base').dataset.previous),next=Number(f('base').value);for(const id of ['start','quantity'])f(id).value=P.integer(f(id).value,old,0,65535,id).toString(next).toUpperCase();if(Number(f('fc').value)===16)f('values').value=M.listValues(f('values').value,false,old).map(v=>v.toString(next)).join(', ');}catch(_){}f('base').dataset.previous=f('base').value;preview();savePrefs();}
    if(e.target.dataset.markName!==undefined){try{marks.rename(marks.items[Number(e.target.dataset.markName)].key,e.target.value);saveMarks();renderMarks();}catch(err){error(err.message);}}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest('#debug-root button');if(!b||b.disabled)return;try{error();
      if(b.id==='dbg-connect')await connect();if(b.id==='dbg-refresh')await refreshPorts();if(b.id==='dbg-grant'){await window.DeviceClient.grant();await refreshPorts();}if(b.id==='dbg-send')await send();
      if(b.id==='dbg-cycle'){if(cycle)stopCycle();else{const ms=P.integer(f('interval').value,10,100,3600000,'扫描周期');await send();if(connected&&f('error').hidden){cycle=setInterval(send,ms);b.textContent='停止扫描';b.classList.add('scanning');}}}
      if(b.dataset.selectPoint!==undefined){selected=Number(b.dataset.selectPoint);updateValues();renderSelected();}
      if(b.dataset.collapseBit!==undefined){if(!bitGroups.some(g=>g.key===b.dataset.collapseBit))return;expandedBits.delete(b.dataset.collapseBit);renderGrid(true);}
      if(b.dataset.expandBit!==undefined){const group=bitGroups.find(g=>g.key===b.dataset.expandBit);if(!group)return;if(!group.indices.includes(selected))selected=group.indices[0];expandedBits.add(group.key);renderGrid();}
      if(b.id==='dbg-fold-bits'){const collapse=bitGroups.every(g=>expandedBits.has(g.key));for(const group of bitGroups)if(collapse)expandedBits.delete(group.key);else expandedBits.add(group.key);renderGrid(true);}
      if(b.dataset.applyExpression!==undefined){const i=Number(b.dataset.applyExpression);applyExpression(i,document.querySelector(`[data-watch-expression="${i}"]`).value);}
      if(b.dataset.markPoint!==undefined)toggleMark(Number(b.dataset.markPoint));if(b.id==='dbg-mark-selected')toggleMark(selected);
      if(b.id==='dbg-pin-selected'){const rule=rules[selected];let chosen={...rule};if(rule.pinKey){pins.remove(rule.pinKey);chosen={...rule,pinKey:undefined,type:last.request.fc<=2?'BOOL':'UINT16',bit:undefined};}else chosen.pinKey=pins.pin(last,rule);savePins();f('mode').value='mixed';updateMode();savePrefs();rebuild(false,chosen);f('pins-details').open=true;}
      if(b.id==='dbg-add-pin-bit'){const rule=rules[selected],address=last.request.start+Number(rule.offset),used=new Set(pins.forRecord(last).filter(p=>p.address===address&&p.type==='BIT').map(p=>p.bit)),bit=Array.from({length:16},(_,i)=>i).find(i=>!used.has(i));if(bit===undefined)throw Error('此寄存器的 16 个位均已固定。');const next={...rule,bit,name:rule.name.slice(0,110)+'_bit'+bit};next.pinKey=pins.pin(last,next);savePins();rebuild(false,next);}
      if(b.dataset.removePin!==undefined){pins.remove(D.pinKey(pins.items[Number(b.dataset.removePin)]));savePins();if(last)rebuild();else renderPins();}
      if(b.dataset.markPin!==undefined){const p=pins.items[Number(b.dataset.markPin)];if(!matchesPin(p))throw Error('尚未读取此固定点对应的设备和数据区。');marks.upsert(entry(D.pinRule(p,last)));saveMarks();renderMarks();updateValues();}
      if(b.id==='dbg-mark-pins'){let count=0,skipped=0;for(const p of pins.forRecord(last)){try{marks.upsert(entry(D.pinRule(p,last)));count++;}catch(_){skipped++;}}saveMarks();renderMarks();updateValues();status(`已标记 ${count} 个固定点${skipped?'，'+skipped+' 个点未覆盖或无法转换':''}。`);}
      if(b.id==='dbg-pins-range'){stopCycle();const range=pins.range(pinContext()),base=Number(f('base').value);f('start').value=range.start.toString(base).toUpperCase();f('quantity').value=range.quantity.toString(base).toUpperCase();preview();savePrefs();status('已带入固定点读取范围，点击“读取一次”或“开始扫描”执行。');}
      if(b.id==='dbg-export-pins')S.download('modbus-fixed-points.json',JSON.stringify({schema:'modbus-fixed-points',version:1,points:pins.save()},null,2));
      if(b.id==='dbg-import-pins')f('pins-file').click();
      if(b.id==='dbg-mark-all'){let n=0,skipped=0;for(const r of rules){try{marks.upsert(entry(r));n++;}catch(_){skipped++;}}saveMarks();renderMarks();updateValues();status(`已标记 ${n} 个点${skipped?'，'+skipped+' 个点无法转换':''}。`);}
      if(b.dataset.unmark!==undefined){marks.remove(marks.items[Number(b.dataset.unmark)].key);saveMarks();renderMarks();updateValues();}
      if(b.id==='dbg-clear-marks'){marks=new D.MarkStore();saveMarks();renderMarks();updateValues();}
      if(['dbg-export-marks','dbg-export-top'].includes(b.id)){assertExpressionsApplied();S.download(exporter.filename||'modbus-marked-points.csv',exporter.csvMarked?exporter.csvMarked(marks.items):exporter.csv?exporter.csv(marks.items.map(item=>item.point)):marks.csv());}
      if(b.id==='dbg-export-watch'){assertExpressionsApplied();S.download('modbus-marked-points.json',JSON.stringify({schema:'modbus-marked-points',version:1,items:marks.save()},null,2));}
      if(b.id==='dbg-import-watch')f('watch-file').click();
      if(b.id==='dbg-clear-log'){logs=[];tx=rx=0;log('SYS',null,'日志已清空');}
      if(b.id==='dbg-export-log')S.download('modbus-debug-log.txt',logs.map(l=>`${l.time} ${l.kind} ${l.message||l.hex}`).join('\r\n'));
      if(b.id==='dbg-export-data')S.download('modbus-readings.csv',S.csv([['时间',...rules.map(r=>r.name)],...history.map(rec=>[rec.receivedAt,...rules.map(r=>{try{return D.view(rec,r).value;}catch(_){return '';}})])]));
    }catch(err){error(err.message);}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset.watchExpression!==undefined){e.preventDefault();try{applyExpression(Number(e.target.dataset.watchExpression),e.target.value);}catch(err){error(err.message);}}});
  window.addEventListener('resize',()=>{drawChart();if(mounted&&last)renderGrid(true);});window.addEventListener('pagehide',()=>{stopCycle();if(mounted)saveMarks();link?.close();});
  setInterval(()=>{if(mounted&&S.active==='debug'&&!connected&&!connecting)refreshPorts();},2500);
  window.ModbusLive={openRequest(req){const c=P.requestContext(req);if(connected&&connection.transport!==c.transport)throw Error('请先断开当前调试连接。');S.navigate('debug');mount();for(const [key,value] of Object.entries({transport:c.transport,slave:c.slave,fc:c.fc,base:10,start:c.start,quantity:c.quantity}))f(key).value=String(value);f('base').dataset.previous='10';updateFields();savePrefs();status('已带入请求参数，连接设备后即可读取。');}};
  if(S.active==='debug')mount();
})();
