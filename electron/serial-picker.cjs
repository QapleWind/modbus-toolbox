'use strict';
// Chromium enumerates the ports; the renderer's dropdown supplies the explicit selection.
class SerialPicker {
  constructor(){this.ports=[];this.prepared=null;this.scan=null;}
  snapshot(){return this.ports.map(port=>({id:port.portId,name:port.displayName||port.portName||port.portId,path:port.portName&&/^(cu\.|tty\.)/.test(port.portName)?'/dev/'+port.portName:port.portName||'',vendor:port.vendorId||'',product:port.productId||''}));}
  prepare(id,contents){
    if(this.scan)return this.scan.promise.then(()=>this.prepare(id,contents));
    if(!this.ports.some(p=>p.portId===id))throw Error('该串口已不可用，请刷新设备列表。');
    this.prepared={id,contents,expires:Date.now()+5000};return true;
  }
  select(ports,contents,callback){
    this.ports=ports;
    if(this.scan?.contents===contents){const scan=this.scan;this.scan=null;clearTimeout(scan.timer);callback('');scan.resolve(this.snapshot());return;}
    const selection=this.prepared;this.prepared=null;
    callback(selection?.contents===contents&&selection.expires>Date.now()&&ports.some(p=>p.portId===selection.id)?selection.id:'');
  }
  list(contents){
    if(this.prepared&&this.prepared.expires>Date.now())return Promise.resolve(this.snapshot());
    if(this.scan)return this.scan.promise;
    const scan={contents};
    scan.promise=new Promise((resolve,reject)=>{scan.resolve=resolve;scan.reject=reject;});this.scan=scan;
    const fail=error=>{if(this.scan!==scan)return;this.scan=null;clearTimeout(scan.timer);scan.reject(error);};
    scan.timer=setTimeout(()=>fail(Error('串口设备枚举超时，请点击刷新。')),12000);
    // Fixed application code only. Discovery cancels the selection and never opens a port.
    contents.executeJavaScript('navigator.serial.requestPort().then(() => null, error => ({ error: error.message }))',true).then(result=>{if(result?.error)fail(Error(result.error));}).catch(fail);
    return scan.promise;
  }
  close(){this.prepared=null;if(this.scan){const scan=this.scan;this.scan=null;clearTimeout(scan.timer);scan.reject(Error('串口枚举已取消。'));}}
}
module.exports={SerialPicker};
