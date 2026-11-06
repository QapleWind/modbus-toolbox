const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {once}=require('node:events');
const {TcpBridge}=require('./tcp-bridge.cjs');

test('native TCP sends exact bytes, receives split replies and handles peer close',async()=>{
  let peer;const server=net.createServer(socket=>{peer=socket;socket.on('data',bytes=>{socket.write(bytes.subarray(0,3));setTimeout(()=>socket.end(bytes.subarray(3)),15);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const bridge=new TcpBridge(),received=[];bridge.on('data',data=>received.push(data.hex));
  try{
    await bridge.connect({host:'127.0.0.1',port:server.address().port});assert(bridge.connected);
    const closed=once(bridge,'state');await bridge.send('00 01 00 00 00 06 01 03 00 00 00 02');await closed;
    assert.equal(received.join(''),'000100000006010300000002');assert.equal(bridge.connected,false);
    await assert.rejects(()=>bridge.send('01'),/尚未连接/);
  }finally{bridge.close();peer?.destroy();await new Promise(resolve=>server.close(resolve));}
});
test('native TCP rejects malformed destinations and oversized sends',async()=>{
  const bridge=new TcpBridge();for(const settings of [{host:'file:///etc/passwd',port:502},{host:'127.0.0.1',port:0},{host:'999.0.0.1',port:502}])await assert.rejects(()=>bridge.connect(settings));
  const server=net.createServer(socket=>socket.on('error',()=>{}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await bridge.connect({host:'127.0.0.1',port:server.address().port});await assert.rejects(()=>bridge.send('GG'));await assert.rejects(()=>bridge.send('00'.repeat(261)));}finally{bridge.close();await new Promise(resolve=>server.close(resolve));}
});
