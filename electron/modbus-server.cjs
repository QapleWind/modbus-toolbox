'use strict';
const net = require('node:net');
const AREAS = ['coils', 'discrete', 'holding', 'input'];
const defaults = () => ({host:'127.0.0.1',port:1502,unit:1,start:0,count:100});
function integer(n,min,max,label){if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'超出范围。');return n;}
class ModbusServer {
  constructor(){this.config=defaults();this.banks=Object.fromEntries(AREAS.map(k=>[k,new Array(100).fill(0)]));this.listener=null;this.sockets=new Set();this.logs=[];this.cursor=0;this.requests=0;this.responses=0;this.writes=0;this.error='';this.starting=false;}
  log(kind,peer='',hex='',message=''){this.logs.push({id:++this.cursor,time:new Date().toISOString(),kind,peer,hex,message});if(this.logs.length>100)this.logs.shift();}
  status(data={}){
    const area=data.area??'holding',offset=integer(data.offset??this.config.start,this.config.start,this.config.start+this.config.count-1,'查看地址'),limit=integer(data.limit??64,1,128,'显示数量'),after=integer(data.after??0,0,Number.MAX_SAFE_INTEGER,'记录游标');
    if(!AREAS.includes(area))throw Error('数据区无效。');
    return {...this.config,running:!!this.listener?.listening,clients:this.sockets.size,requests:this.requests,responses:this.responses,writes:this.writes,error:this.error,area,offset,values:this.banks[area].slice(offset-this.config.start,Math.min(this.config.count,offset-this.config.start+limit)),logs:this.logs.filter(l=>l.id>after),cursor:this.cursor};
  }
  set(data){
    const {area,address,values}=data;if(!AREAS.includes(area)||!Array.isArray(values)||!values.length||values.length>128)throw Error('请选择数据区并输入 1–128 个值。');
    integer(address,this.config.start,this.config.start+this.config.count-values.length,'写入地址');values.forEach(v=>integer(v,0,area==='coils'||area==='discrete'?1:65535,'数值'));
    this.banks[area].splice(address-this.config.start,values.length,...values);this.log('SYS','','',`手动设置 ${area} 地址 ${address}，${values.length} 个值`);return {ok:true};
  }
  async start(data){
    if(this.listener||this.starting)throw Error('服务端已启动，请先停止。');
    const c={host:data.host,port:integer(data.port,1,65535,'监听端口'),unit:integer(data.unit,1,247,'设备 ID'),start:integer(data.start,0,65535,'起始地址'),count:integer(data.count,1,4096,'地址数量')};
    if(!net.isIPv4(c.host)||c.start+c.count>65536)throw Error('监听地址或寄存器范围无效。');
    this.starting=true;const server=net.createServer(socket=>this.accept(socket));this.listener=server;
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.port,c.host,()=>{server.removeListener('error',reject);resolve();});});
      if(this.listener!==server){server.close();throw Error('启动已取消。');}
      if(c.start!==this.config.start||c.count!==this.config.count)this.banks=Object.fromEntries(AREAS.map(k=>[k,new Array(c.count).fill(0)]));
      this.config=c;this.error='';this.requests=this.responses=this.writes=0;this.log('SYS','','',`开始监听 ${c.host}:${c.port}`);
      server.on('error',error=>{this.error=error.message;this.stop();});return {ok:true};
    }catch(error){if(this.listener===server)this.listener=null;try{server.close();}catch(_){}this.error=error.message;throw error;}finally{this.starting=false;}
  }
  stop(){const server=this.listener;this.listener=null;for(const socket of this.sockets)socket.destroy();this.sockets.clear();if(server){server.close();this.log('SYS','','','服务端已停止');}return {ok:true};}
  clear(){this.logs=[];return {ok:true};}
  accept(socket){
    if(this.sockets.size>=16){socket.destroy();return;}this.sockets.add(socket);socket.setNoDelay(true);socket.setTimeout(60000,()=>socket.destroy());
    const peer=socket.remoteAddress+':'+socket.remotePort;this.log('SYS',peer,'','客户端已连接');let buffer=Buffer.alloc(0);
    socket.on('error',error=>this.log('SYS',peer,'',error.message));socket.on('close',()=>{this.sockets.delete(socket);this.log('SYS',peer,'','客户端已断开');});
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=6){
        const size=buffer.readUInt16BE(4);
        if(buffer.readUInt16BE(2)!==0||size<2||size>254){this.log('SYS',peer,'','MBAP 头无效，已断开');socket.destroy();return;}
        if(buffer.length<6+size)break;
        const frame=buffer.subarray(0,6+size);buffer=buffer.subarray(6+size);const reply=this.handle(frame,peer);
        if(reply){socket.write(reply);if(socket.writableLength>65536){socket.destroy();return;}}
      }
    });
  }
  handle(frame,peer=''){
    this.requests++;this.log('RX',peer,frame.toString('hex').toUpperCase());
    if(frame[6]!==this.config.unit)return null;
    const p=frame.subarray(7),fc=p[0];let reply;
    const exception=code=>Buffer.from([fc|128,code]);
    if(![1,2,3,4,5,6,15,16].includes(fc))reply=exception(1);
    else if(p.length<5)reply=exception(3);
    else{
      const address=p.readUInt16BE(1),quantity=p.readUInt16BE(3),index=address-this.config.start;
      const inRange=n=>index>=0&&index+n<=this.config.count;
      if(fc<=4){
        if(p.length!==5||quantity<1||quantity>(fc<=2?2000:125))reply=exception(3);
        else if(!inRange(quantity))reply=exception(2);
        else{const values=this.banks[AREAS[fc-1]].slice(index,index+quantity),data=Buffer.alloc(fc<=2?Math.ceil(quantity/8):quantity*2);values.forEach((v,i)=>{if(fc<=2)data[i>>3]|=v<<(i%8);else data.writeUInt16BE(v,i*2);});reply=Buffer.concat([Buffer.from([fc,data.length]),data]);}
      }else if(fc===5||fc===6){
        if(p.length!==5||(fc===5&&quantity!==0&&quantity!==0xff00))reply=exception(3);
        else if(!inRange(1))reply=exception(2);
        else{this.banks[fc===5?'coils':'holding'][index]=fc===5?Number(quantity===0xff00):quantity;this.writes++;reply=Buffer.from(p);}
      }else{
        const bytes=fc===15?Math.ceil(quantity/8):quantity*2;
        if(quantity<1||quantity>(fc===15?1968:123)||p.length!==6+bytes||p[5]!==bytes)reply=exception(3);
        else if(!inRange(quantity))reply=exception(2);
        else{const bank=this.banks[fc===15?'coils':'holding'];for(let i=0;i<quantity;i++)bank[index+i]=fc===15?(p[6+(i>>3)]>>(i%8))&1:p.readUInt16BE(6+i*2);this.writes++;reply=Buffer.from(p.subarray(0,5));}
      }
    }
    const head=Buffer.from(frame.subarray(0,7));head.writeUInt16BE(reply.length+1,4);const result=Buffer.concat([head,reply]);this.responses++;this.log('TX',peer,result.toString('hex').toUpperCase());return result;
  }
  action(action,data={}){if(!['start','stop','status','set','clear'].includes(action))throw Error('服务端操作无效。');return this[action](data);}
}
module.exports={ModbusServer};
