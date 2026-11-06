const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('./modbus-points.js');
const point=o=>({transport:'rtu',device:'COM3',slave:1,fc:3,address:0,type:'UINT16',order:'ABCD',factor:'1',constant:'0',name:'temperature',...o});
test('generic points accept host serial names and preserve packet orders at every width',()=>{
  for(const device of ['COM3','/dev/ttyUSB0','/dev/cu.usbserial'])for(const type of Object.keys(P.TYPES).filter(t=>t!=='BOOL'))for(const order of P.ORDERS){const p=P.normalize(point({device,type,order}));assert.equal(p.device,device);assert.equal(p.order,order);assert(!Object.hasOwn(P.TYPES[type],'code'));}
});
test('CSV has descriptive generic fields and separate numeric scale parameters',()=>{
  const csv=P.csv([point({name:'温度,"一"',type:'FLOAT32',order:'ABCD',factor:0,constant:-2}),point({name:'counter',transport:'tcp',device:'192.0.2.10:1502',type:'UINT64',order:'CDAB',address:16})]);
  assert(csv.startsWith('\uFEFF"name","transport","device","slave_id"'));assert(csv.includes('"温度,""一"""'));assert(csv.includes('"FLOAT32","2","ABCD","0","-2"'));assert(csv.includes('"UINT64","4","CDAB"'));assert(!csv.includes('point_data_'));assert(csv.endsWith('\r\n'));
});
test('CSV rejects invalid definitions, duplicate names and spreadsheet formula names',()=>{
  for(const name of ['=cmd','+cmd','-cmd','@cmd','\t=cmd','a\nb'])assert.throws(()=>P.csv([point({name})]));
  assert.throws(()=>P.csv([point(),point()]),/重复/);assert.throws(()=>P.csv([]));
  for(const bad of [{factor:'Infinity'},{constant:'NaN'},{address:65535,type:'FLOAT32'},{fc:1},{slave:0},{device:''}])assert.throws(()=>P.normalize(point(bad)));
});
test('coil types and TCP unit IDs use Modbus limits',()=>{
  assert.equal(P.normalize(point({fc:1,type:'BOOL',order:'DCBA'})).order,'ABCD');assert.equal(P.normalize(point({transport:'tcp',slave:255})).slave,255);
  assert.throws(()=>P.normalize(point({type:'BOOL'})));assert.throws(()=>P.normalize(point({transport:'tcp',slave:256})));
});
test('TCP endpoints validate actual user input without imposing an export convention',()=>{
  assert.equal(P.tcpDevice('192.0.2.1','1502'),'192.0.2.1:1502');
  for(const host of ['hostname','192.0.2.256','127.0.0.1/502','1.2.3'])assert.throws(()=>P.tcpDevice(host,502));for(const port of [0,65536,'502abc'])assert.throws(()=>P.tcpDevice('127.0.0.1',port));
});
test('request import rejects address overflow and preserves zero-based offsets',()=>{
  const request={transport:'tcp',base:16,slave:'FF',fc:'3',start:'0010',quantity:'0004'};
  assert.deepEqual(P.requestContext(request),{transport:'tcp',slave:255,fc:3,start:16,quantity:4});assert.throws(()=>P.requestContext({...request,start:'FFFF'}),/读取范围/);
});
test('register bit CSV carries an explicit bit index and ordinary exports keep the old header',()=>{
  const bit=point({type:'BIT',bit:15,name:'alarm',address:65535}),normal=point();assert.equal(P.normalize(bit).bit,15);
  const text=P.csv([normal,bit]);assert(text.split('\r\n')[0].endsWith('"bit_index"'));assert(text.includes('"BIT","1","ABCD","1","0","15"'));
  assert(!P.csv([normal]).includes('bit_index'));assert.throws(()=>P.normalize({...bit,bit:16}),/位号/);assert.throws(()=>P.normalize({...bit,fc:1}),/BOOL/);
});
