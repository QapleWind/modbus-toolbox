'use strict';
const net=require('node:net');
const {EventEmitter}=require('node:events');
class TcpBridge extends EventEmitter{
  constructor(){super();this.socket=null;this.connected=false;this.generation=0;}
  close(){this.generation++;this.connected=false;if(this.socket)this.socket.destroy();this.socket=null;return {connected:false};}
  async connect(settings){
    const host=String(settings?.host||'').trim(),port=Number(settings?.port);
    if(!net.isIPv4(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('请输入有效 IPv4 地址和 1–65535 端口。');
    this.close();const own=this.generation;
    return new Promise((resolve,reject)=>{
      const socket=net.createConnection({host,port});this.socket=socket;let settled=false;
      const timer=setTimeout(()=>socket.destroy(Error('TCP 连接超时。')),4000);
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve({connected:true,host,port});};
      socket.setNoDelay(true);
      socket.on('connect',()=>{if(own!==this.generation){finish(Error('连接已取消。'));socket.destroy();return;}this.connected=true;finish();});
      socket.on('data',bytes=>{if(own===this.generation)this.emit('data',{hex:bytes.toString('hex')});});
      socket.on('error',error=>{finish(error);if(own===this.generation)this.emit('state',{connected:false,error:error.message});});
      socket.on('close',()=>{finish(Error('TCP 连接已关闭。'));if(own===this.generation){this.connected=false;this.socket=null;this.emit('state',{connected:false});}});
    });
  }
  async send(hex){
    if(!this.connected||!this.socket)throw Error('TCP 尚未连接。');
    if(typeof hex!=='string'||! /^(?:[0-9a-f]{2}\s*)+$/i.test(hex))throw Error('无效 HEX 数据。');
    const bytes=Buffer.from(hex.replace(/\s/g,''),'hex');if(!bytes.length||bytes.length>260)throw Error('TCP 报文须为 1–260 字节。');
    const socket=this.socket;await new Promise((resolve,reject)=>socket.write(bytes,error=>error?reject(error):resolve()));return {written:bytes.length};
  }
}
module.exports={TcpBridge};
