'use strict';
(() => {
  const M=window.Modbus;
  let serialOwner='',backendSupported=null,knownPorts=[],browserPorts=new Map(),browserId=0,listing=null;
  window.SerialAccess={claim(owner){if(serialOwner&&serialOwner!==owner)throw Error('请先断开'+(serialOwner==='debug'?'Modbus 调试':'串口报文')+'中的串口连接。');serialOwner=owner;},release(owner){if(serialOwner===owner)serialOwner='';},get busy(){return !!serialOwner;}};
  async function api(kind,action,body){
    const response=await fetch(`/api/${kind}/${action}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},keepalive:kind==='server'&&action==='stop',body:body?JSON.stringify(body):undefined});
    const data=await response.json();if(!response.ok)throw Error(data.error||'本机通信服务请求失败。');return data;
  }
  async function ports(){
    if(serialOwner)return knownPorts;
    if(listing)return listing;
    listing=(async()=>{
      let result=[];
      if(window.desktop?.kind==='electron')result=(await window.desktop.serialList()).map(p=>({id:p.id,name:p.path&&p.name!==p.path&&!p.path.endsWith('/'+p.name)?p.path+' · '+p.name:p.path||p.name,endpoint:p.path||p.name}));
      else{
        try{const data=await api('serial','ports');backendSupported=data.supported;result=data.ports.map(path=>({id:path,name:path,endpoint:path}));}catch(_){backendSupported=false;}
        if(!backendSupported&&'serial' in navigator){
          const authorized=await navigator.serial.getPorts(),next=new Map();
          for(const port of authorized){const prior=[...browserPorts].find(([,p])=>p===port),id=prior?.[0]||'browser:'+(++browserId),info=port.getInfo();next.set(id,port);result.push({id,name:'串口 '+id.slice(8)+(info.usbVendorId?' · USB '+info.usbVendorId.toString(16).toUpperCase():''),endpoint:'浏览器串口 '+id.slice(8)});}
          browserPorts=next;
        }
      }
      knownPorts=result;return result;
    })();
    try{return await listing;}finally{listing=null;}
  }
  async function grant(){await navigator.serial.requestPort();return ports();}
  function needsGrant(){return window.desktop?.kind!=='electron'&&backendSupported===false&&'serial' in navigator;}
  class Link{
    constructor(onData,onClose,owner='debug'){this.onData=onData;this.onClose=onClose;this.owner=owner;this.closed=false;this.timer=null;this.kind='';this.unsub=[];}
    async serial(settings){
      if(!settings.port)throw Error('请选择可用串口。');
      window.SerialAccess.claim(this.owner);
      try{
        if(window.desktop?.kind==='electron'||settings.port.startsWith('browser:')){
          if(window.desktop?.kind==='electron'){await window.desktop.selectSerial(settings.port);this.port=await navigator.serial.requestPort();}
          else{this.port=browserPorts.get(settings.port);if(!this.port)throw Error('串口已移除，请刷新设备列表。');}
          await this.port.open({baudRate:settings.baud,dataBits:settings.bits,stopBits:settings.stop,parity:settings.parity,flowControl:'none'});
          this.kind='webserial';this.endpoint=knownPorts.find(p=>p.id===settings.port)?.endpoint||settings.port;this.readerTask=this.readNative();
        }else{await api('serial','connect',settings);this.kind='serial';this.endpoint=settings.port;this.poll('serial');}
        return this;
      }catch(error){await this.close();window.SerialAccess.release(this.owner);throw error;}
    }
    async tcp(settings){
      this.endpoint=settings.host+':'+settings.port;
      if(window.desktop?.kind==='electron'){
        this.kind='desktop-tcp';
        this.unsub.push(window.desktop.onTcpData(data=>{if(!this.closed)this.onData(M.parseHex(data.hex));}),window.desktop.onTcpState(state=>{if(!this.closed&&!state.connected)this.ended(state.error||'TCP 连接已关闭。');}));
        try{await window.desktop.tcpConnect(settings);}catch(error){await this.close();throw error;}
      }else{this.kind='tcp';await api('tcp','connect',settings);this.poll('tcp');}
      return this;
    }
    async readNative(){
      let failure='串口已关闭。';
      try{this.reader=this.port.readable.getReader();while(!this.closed){const r=await this.reader.read();if(r.done)break;if(r.value)this.onData(r.value);}}
      catch(error){failure=error.message;}
      finally{this.reader?.releaseLock();this.reader=null;if(!this.closed){this.closed=true;try{await this.port.close();}catch(_){}window.SerialAccess.release(this.owner);this.onClose(failure);}}
    }
    async poll(kind){
      if(this.closed)return;
      try{const data=await api(kind,'read');if(this.closed)return;if(data.hex)this.onData(M.parseHex(data.hex));if(!data.connected){this.ended('连接已关闭。');return;}this.timer=setTimeout(()=>this.poll(kind),60);}
      catch(error){if(!this.closed)this.ended(error.message);}
    }
    async send(bytes){
      if(this.closed)throw Error('连接已关闭。');
      if(this.kind==='webserial'){const writer=this.port.writable.getWriter();try{await writer.write(bytes);}finally{writer.releaseLock();}}
      else if(this.kind==='desktop-tcp')await window.desktop.tcpSend(M.hex(bytes));
      else await api(this.kind,'send',{hex:M.hex(bytes)});
    }
    async ended(message){if(this.closed)return;await this.close();this.onClose(message);}
    async close(){
      if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.unsub.splice(0).forEach(fn=>fn());
      try{
        if(this.kind==='webserial'){if(this.reader)await this.reader.cancel();if(this.readerTask)await this.readerTask;await this.port?.close();}
        else if(this.kind==='desktop-tcp')await window.desktop.tcpDisconnect();
        else if(this.kind)await api(this.kind,'disconnect',{});
      }catch(_){}finally{if(this.owner)window.SerialAccess.release(this.owner);}
    }
  }
  window.DeviceClient={ports,grant,needsGrant,Link,server(action,data={}){return window.desktop?.kind==='electron'?window.desktop.serverAction(action,data):api('server',action,data);}};
})();
