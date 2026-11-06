const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const M=require('./protocol.js');
function setup(desktop,navigator={},fetch=()=>{throw Error('Unexpected HTTP access');}){const window={Modbus:M,desktop},sandbox={window,navigator,fetch,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(__dirname+'/device-client.js','utf8'),sandbox);return window;}
test('desktop lists actual ports and connects only the selected ID, without dialog API or fallback devices',async()=>{
  let releaseRead;const calls=[],port={async open(settings){calls.push(['open',settings]);},async close(){},readable:{getReader(){return {async read(){return new Promise(resolve=>{releaseRead=resolve;});},async cancel(){releaseRead({done:true});},releaseLock(){}};}}};
  const w=setup({kind:'electron',async serialList(){return [{id:'p7',path:'COM7',name:'USB Serial'}];},async selectSerial(id){calls.push(['select',id]);}},{serial:{async requestPort(){calls.push(['request']);return port;}}});
  assert.deepEqual(JSON.parse(JSON.stringify(await w.DeviceClient.ports())),[{id:'p7',name:'COM7 · USB Serial',endpoint:'COM7'}]);
  const link=new w.DeviceClient.Link(()=>{},()=>{});await link.serial({port:'p7',baud:9600,bits:8,stop:1,parity:'none'});assert.equal(link.endpoint,'COM7');assert.equal(w.SerialAccess.busy,true);assert.equal(calls[0][1],'p7');assert.equal(calls[1][0],'request');assert.equal(calls[2][0],'open');await link.close();assert.equal(w.SerialAccess.busy,false);
});
test('no-device lists stay empty and failed opening releases ownership',async()=>{
  const w=setup({kind:'electron',async serialList(){return [];},async selectSerial(){throw Error('removed');}},{serial:{async requestPort(){throw Error('must not request');}}});
  assert.equal((await w.DeviceClient.ports()).length,0);const link=new w.DeviceClient.Link(()=>{},()=>{});await assert.rejects(link.serial({port:'gone'}),/removed/);assert.equal(w.SerialAccess.busy,false);assert.equal(link.closed,true);
});
test('Modbus server controls use desktop IPC or same-origin HTTP and stop survives page exit',async()=>{
  const calls=[],w=setup({kind:'electron',serverAction(action,data){calls.push([action,data]);return Promise.resolve({ok:true});}});
  await w.DeviceClient.server('set',{area:'holding',address:0,values:[123]});assert.equal(calls[0][0],'set');
  const http=[];const browser=setup(null,{},async(url,options)=>{http.push([url,options]);return {ok:true,async json(){return {ok:true};}};});
  await browser.DeviceClient.server('stop',{});assert.equal(http[0][0],'/api/server/stop');assert.equal(http[0][1].method,'POST');assert.equal(http[0][1].keepalive,true);
});
test('local bridge paths are used directly and other owners cannot connect concurrently',async()=>{
  const calls=[];
  const w=setup(null,{},async(url,options)=>{calls.push([url,options]);return {ok:true,async json(){if(url.endsWith('/ports'))return {ports:['/dev/cu.usbserial'],supported:true};return {connected:true,hex:''};}};});
  assert.equal((await w.DeviceClient.ports())[0].id,'/dev/cu.usbserial');w.SerialAccess.claim('rawserial');
  await assert.rejects(new w.DeviceClient.Link(()=>{},()=>{}).serial({port:'/dev/cu.usbserial'}),/串口报文/);assert.equal(w.SerialAccess.busy,true);w.SerialAccess.release('rawserial');
  assert.equal(w.DeviceClient.needsGrant(),false);
});
