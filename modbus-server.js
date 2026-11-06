'use strict';
(() => {
  const S=window.Suite,M=S.M,{$,E}=S;
  const areas=[['holding','保持寄存器 · 03 / 06 / 10'],['input','输入寄存器 · 04'],['coils','线圈 · 01 / 05 / 0F'],['discrete','离散输入 · 02']];
  let mounted=false,running=false,busy=false,reading=false,pollError=false,epoch=0,cursor=0,selected=0,state=null,lines=[],previous=new Map();
  const f=id=>$('srv-'+id),input=(id,label,value)=>S.input('srv-'+id,label,value),select=(id,label,options)=>S.select('srv-'+id,label,options);
  const num=(id,min,max)=>M.integer(f(id).value,10,min,max,f(id).closest('label')?.firstChild.textContent||'数值');
  function error(message=''){f('error').textContent=message;f('error').hidden=!message;}
  function mount(){
    if(mounted||!$('server-root'))return;mounted=true;
    $('server-root').innerHTML=S.card('TCP 服务端',`<div class="srv-config">${select('host','监听范围',S.opts([['127.0.0.1','本机 · 127.0.0.1'],['0.0.0.0','全部网卡 · 0.0.0.0']]))}${input('port','监听端口','1502')}${input('unit','设备 ID','1')}${input('start','起始协议地址','0')}${input('count','每区地址数量','100')}<button id="srv-toggle" class="button primary" type="button">启动服务端</button></div><div class="srv-status"><span id="srv-status">未启动</span><span>客户端 <b id="srv-clients">0</b></span><span>请求 <b id="srv-requests">0</b></span><span>响应 <b id="srv-responses">0</b></span><span>客户端写入 <b id="srv-writes">0</b></span></div>${S.err('srv')}<p class="helper">其他设备连接时选择“全部网卡”，客户端填写本机实际 IP；默认端口为 1502。四个数据区使用相同地址范围，改变范围会将数值清零。</p>`)+S.card('数据区',`<div class="srv-toolbar">${select('area','数据区',S.opts(areas))}${input('offset','查看协议地址','0')}<button id="srv-view" class="button" type="button">查看</button><button id="srv-prev" class="button" type="button">上一页</button><button id="srv-next" class="button" type="button">下一页</button><span id="srv-range" class="helper"></span></div><div class="srv-workbench"><div id="srv-grid" class="srv-grid" aria-label="服务端寄存器值"></div><div class="srv-editor"><h3 id="srv-selected">选中地址 0</h3>${select('type','数据类型',S.typeOptions('UINT16'))}${select('order','字节序',S.orderOptions())}${input('value','设置值','0')}<button id="srv-apply" type="button" class="button primary">写入所选地址</button><p id="srv-raw" class="helper mono"></p><p class="helper">线圈和离散输入填 0 或 1；寄存器按数据类型占用连续地址。输入寄存器与离散输入可在此设置，对客户端保持只读。</p></div></div>`)+S.card('通信记录',`<div class="actions"><button id="srv-clear" type="button" class="button">清空记录</button><button id="srv-export" type="button" class="button">导出记录</button></div><textarea id="srv-log" class="mono srv-log" rows="7" readonly aria-label="服务端通信记录"></textarea><p class="helper">支持 01、02、03、04、05、06、0F、10 功能码。切换工具可继续运行，关闭窗口或退出登录后停止；服务端数值在本次进程中保留。</p>`);
    poll();
  }
  const bitArea=()=>['coils','discrete'].includes(f('area').value);
  const width=()=>bitArea()?1:M.TYPES[f('type').value][0]/2;
  function currentValue(address){
    if(!state)return null;const index=address-state.offset,words=state.values.slice(index,index+width());if(index<0||words.length!==width())return null;
    return bitArea()?String(words[0]):String(M.decode(Uint8Array.from(words.flatMap(n=>[n>>8,n&255])),f('type').value,f('order').value));
  }
  function editor(fill=false){
    f('selected').textContent='选中协议地址 '+selected;f('type').disabled=bitArea();f('order').disabled=bitArea();
    const value=currentValue(selected),index=state?selected-state.offset:-1;
    f('raw').textContent=index>=0?'原始值 '+(state.values.slice(index,index+width()).map(v=>bitArea()?v:v.toString(16).toUpperCase().padStart(4,'0')).join(' ')):'';
    if(fill&&value!==null)f('value').value=value;
  }
  function render(){
    const step=width(),cells=[];
    for(let i=0;i<state.values.length;i+=step){
      const address=state.offset+i,value=currentValue(address),key=state.area+':'+address,raw=state.values.slice(i,i+step).join(','),changed=previous.has(key)&&previous.get(key)!==raw;previous.set(key,raw);
      cells.push(`<button type="button" class="srv-cell ${address===selected?'selected':''} ${changed?'changed':''}" data-server-address="${address}"><small>${address} <span>0x${address.toString(16).toUpperCase().padStart(4,'0')}</span></small><strong>${E(value??'—')}</strong></button>`);
    }
    f('grid').innerHTML=cells.join('');f('range').textContent=`范围 ${state.start}–${state.start+state.count-1}`;editor();
  }
  async function poll(){
    if(!mounted||busy||reading)return;reading=true;const own=epoch;
    try{
      const result=await window.DeviceClient.server('status',{area:f('area').value,offset:num('offset',0,65535),limit:64,after:cursor});if(own!==epoch)return;
      if(pollError){error();pollError=false;}if(result.cursor<cursor){lines=[];f('log').value='';}state=result;running=result.running;cursor=result.cursor;
      for(const id of ['clients','requests','responses','writes'])f(id).textContent=result[id];
      for(const id of ['host','port','unit','start','count']){f(id).disabled=running;if(running)f(id).value=String(result[id]);}
      f('toggle').textContent=running?'停止服务端':'启动服务端';f('status').textContent=running?`监听中 · ${result.host}:${result.port} · 设备 ${result.unit}`:'未启动';f('status').classList.toggle('srv-online',running);
      if(result.logs.length){for(const l of result.logs)lines.push(`${new Date(l.time).toLocaleTimeString()} ${l.kind} ${l.peer||''} ${l.message||l.hex}`);lines=lines.slice(-100);const log=f('log'),atBottom=log.scrollTop+log.clientHeight>=log.scrollHeight-30;log.value=lines.join('\n');if(atBottom)log.scrollTop=log.scrollHeight;}
      if(selected<result.offset||selected>=result.offset+result.values.length)selected=result.offset;render();
      if(result.error)error(result.error);
    }catch(e){if(own===epoch){pollError=true;error(e.message==='Failed to fetch'?'无法连接通信服务，请确认工具箱已启动。':e.message);}}finally{reading=false;}
  }
  async function action(fn){if(busy)return;busy=true;epoch++;pollError=false;error();for(const id of ['toggle','apply'])f(id).disabled=true;try{await fn();}catch(e){error(e.message);}finally{busy=false;for(const id of ['toggle','apply'])f(id).disabled=false;await poll();}}
  document.addEventListener('toolchange',event=>{if(event.detail.tool==='server')mount();});
  document.addEventListener('click',event=>{
    const b=event.target.closest('#server-root button');if(!b)return;
    if(b.dataset.serverAddress!==undefined){selected=Number(b.dataset.serverAddress);render();editor(true);return;}
    if(b.id==='srv-toggle')action(async()=>{
      if(running)await window.DeviceClient.server('stop',{});
      else{const data={host:f('host').value,port:num('port',1,65535),unit:num('unit',1,247),start:num('start',0,65535),count:num('count',1,4096)};await window.DeviceClient.server('start',data);f('offset').value=data.start;selected=data.start;previous.clear();}
    });
    if(b.id==='srv-apply')action(async()=>{
      let values;if(bitArea())values=[num('value',0,1)];else{const bytes=M.encode(f('value').value,f('type').value,f('order').value);values=Array.from({length:bytes.length/2},(_,i)=>bytes[i*2]*256+bytes[i*2+1]);}
      await window.DeviceClient.server('set',{area:f('area').value,address:selected,values});
    });
    if(['srv-view','srv-prev','srv-next'].includes(b.id)){try{error();pollError=false;if(b.id!=='srv-view')f('offset').value=Math.max(state?.start||0,Math.min((state?.start||0)+(state?.count||100)-1,num('offset',0,65535)+(b.id==='srv-next'?64:-64)));epoch++;poll();}catch(e){error(e.message);}}
    if(b.id==='srv-clear')action(async()=>{await window.DeviceClient.server('clear',{});lines=[];f('log').value='';});
    if(b.id==='srv-export')S.download('modbus-server-log.txt',lines.join('\r\n'));
  });
  document.addEventListener('change',event=>{if(!mounted)return;if(event.target===f('area')){epoch++;previous.clear();poll();}if(['srv-type','srv-order'].includes(event.target.id)){render();editor(true);}});
  setInterval(()=>{if(mounted&&(S.active==='server'||running))poll();},750);
  window.addEventListener('pagehide',()=>{if(running&&!window.IoTRuntime)window.DeviceClient.server('stop',{}).catch(()=>{});});
  if(S.active==='server')mount();
})();
