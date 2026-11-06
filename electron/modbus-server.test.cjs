const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {once}=require('node:events');
const {ModbusServer}=require('./modbus-server.cjs');
const vectors=require('../testdata/server-vectors.json');
function seed(){const s=new ModbusServer();s.config.start=10;s.config.count=16;s.banks=Object.fromEntries(['coils','discrete','holding','input'].map(k=>[k,Array(16).fill(0)]));for(const [area,values]of Object.entries({coils:[1,0,1,0,0,0,0,1,1],discrete:[0,1,1],holding:[0x1234,0xabcd],input:[0x5678,65535]}))s.set({area,address:10,values});return s;}
function frame(pdu,unit=1,id=0xabcd){const p=Buffer.from(pdu,'hex'),h=Buffer.alloc(7);h.writeUInt16BE(id);h.writeUInt16BE(p.length+1,4);h[6]=unit;return Buffer.concat([h,p]);}
test('shared wire vectors cover eight functions, bank boundaries, atomic writes and wrong unit',()=>{
  for(const v of vectors){const s=seed(),reply=s.handle(frame(v.pdu,v.unit));assert.equal(reply?.subarray(7).toString('hex').toUpperCase()??null,v.reply,v.name);if(reply){assert.equal(reply.readUInt16BE(0),0xabcd);assert.equal(reply.readUInt16BE(4),reply.length-6);}if(v.area)assert.deepEqual(s.status({area:v.area,offset:v.address,limit:v.values.length}).values,v.values,v.name);}
});
test('local edits validate the entire value block and preserve 65535 endpoint',()=>{
  const s=seed();assert.throws(()=>s.set({area:'coils',address:10,values:[1,2]}));assert.deepEqual(s.status({area:'coils',offset:10,limit:2}).values,[1,0]);assert.throws(()=>s.set({area:'holding',address:25,values:[1,2]}));
  s.config={...s.config,start:65535,count:1};s.banks.holding=[65535];assert.equal(s.handle(frame('03FFFF0001')).subarray(7).toString('hex'),'0302ffff');assert.throws(()=>s.action('__proto__',{}));
});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
test('real listener handles fragmented and coalesced requests, occupied ports, stop and restart',async()=>{
  const port=await freePort(),s=new ModbusServer();let socket;
  try{
    await s.start({host:'127.0.0.1',port,unit:1,start:0,count:100});s.set({area:'holding',address:0,values:[42]});socket=net.connect(port,'127.0.0.1');await once(socket,'connect');
    let received=Buffer.alloc(0);const expected=Buffer.concat([frame('0302002A',1,7),frame('060001007B',1,8),frame('0302007B',1,9)]);
    const data=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('response timeout')),2000);socket.on('data',part=>{received=Buffer.concat([received,part]);if(received.length>=expected.length){clearTimeout(timer);resolve();}});});
    const read=frame('0300000001',1,7);socket.write(read.subarray(0,3));await new Promise(r=>setTimeout(r,15));socket.write(Buffer.concat([read.subarray(3),frame('060001007B',1,8),frame('0300010001',1,9)]));await data;assert.deepEqual(received,expected);assert.equal(s.status().writes,1);
    const other=new ModbusServer();await assert.rejects(other.start({host:'127.0.0.1',port,unit:1,start:0,count:100}));assert.equal(other.status().running,false);
    const closed=once(socket,'close');s.stop();await closed;assert.equal(s.status().clients,0);await s.start({host:'127.0.0.1',port,unit:1,start:0,count:100});assert.equal(s.status().values[1],123);
    const bad=net.connect(port,'127.0.0.1');await once(bad,'connect');const rejected=once(bad,'close');bad.write(Buffer.from('000100010006010300000001','hex'));await rejected;assert.equal(s.status().running,true);
  }finally{socket?.destroy();s.stop();}
});
