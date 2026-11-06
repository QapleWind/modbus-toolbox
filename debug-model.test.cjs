const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./transports.js'),D=require('./debug-model.js');
const config=o=>({transport:'rtu',base:16,slave:'1',fc:'3',start:'0010',quantity:'0004',coil:'1',values:'0001,0002',...o});
const source=o=>({endpoint:'/dev/ttyS0',device:'/dev/ttyS0/9600/N',demo:false,...o});
const rule=o=>({name:'temperature',offset:'0',type:'UINT16',order:'ABCD',factor:'1',constant:'0',...o});
function reply(req,values=[10,20,30,40]){return M.buildPacket({base:10,slave:String(req.slave),fc:String(req.fc),transaction:String(req.transaction),rows:values.map(v=>({type:'UINT16',order:'ABCD',value:String(v)})),values:values.join(',')},'response',req.transport);}
function read(c={},s={}){const req=D.request(config(c),source(s),123);const r=D.match(req,reply(req));assert.equal(r.kind,'read');return r.record;}

test('the displayed and marked address stays with the successful request snapshot',()=>{
  const c=config(),s=source(),req=D.request(c,s,7);c.start='FFFF';c.slave='3';s.device='/dev/ttyS9';
  const rec=D.match(req,reply(req)).record;
  const view=D.view(rec,rule({offset:'2'})),mark=D.mark(rec,rule({offset:'2'}));
  assert.equal(view.address,18);assert.equal(view.value,'30');assert.equal(mark.point.address,18);assert.equal(mark.point.slave,1);assert.equal(mark.point.device,'/dev/ttyS0/9600/N');assert(Object.isFrozen(req.source));
});
test('RTU framing survives fragmentation, concatenation, leading noise and corrupted CRC',()=>{
  const req=D.request(config(),source()),good=reply(req),bad=Uint8Array.from(good);bad[bad.length-1]^=1;
  const s=new D.FrameStream('rtu');assert.equal(s.push(good.slice(0,4)).length,0);
  assert.deepEqual(Array.from(s.push(good.slice(4))[0]),Array.from(good));
  assert.equal(s.push(Uint8Array.from([255,0,...bad,...good,...good])).length,2);
});
test('TCP framing preserves MBAP boundaries for every split and coalesced responses',()=>{
  const req=D.request(config({transport:'tcp',slave:'255'}),source({device:'127.0.0.1/502'}),65535),packet=reply(req);
  for(let n=1;n<packet.length;n++){const s=new D.FrameStream('tcp');assert.equal(s.push(packet.slice(0,n)).length,0);assert.deepEqual(Array.from(s.push(packet.slice(n))[0]),Array.from(packet));}
  assert.equal(new D.FrameStream('tcp').push(Uint8Array.from([...packet,...packet])).length,2);
  assert.equal(D.match(req,packet).kind,'read');
});
test('wrong transaction, unit, function and declared response size cannot become current points',()=>{
  const req=D.request(config({transport:'tcp'}),source({device:'127.0.0.1/502'}),9),packet=reply(req);
  for(const [index,value] of [[1,10],[6,2],[7,4]]){const bad=Uint8Array.from(packet);bad[index]=value;assert.equal(D.match(req,bad).kind,'ignore');}
  assert.equal(D.match(req,reply(req,[1,2])).kind,'ignore');
  const ex=M.buildPacket({base:10,slave:'1',fc:'3',exception:true,exceptionCode:'2',transaction:'9'},'response','tcp');
  assert.equal(D.match(req,ex).kind,'exception');
});
test('a write confirmation is acknowledged without inventing a read point',()=>{
  const req=D.request(config({fc:'6',quantity:'1234'}),source());
  assert.equal(D.match(req,Uint8Array.from(req.bytes)).kind,'write');
  assert.throws(()=>D.mark(null,rule()),/有效响应/);
});
test('register and coil layouts derive actual point addresses and values',()=>{
  const rec=read();assert.deepEqual(D.layout(rec,'FLOAT32').map(r=>r.offset),['0','2']);
  assert.equal(D.mark(rec,rule({type:'FLOAT32'})).point.order,'ABCD');
  const req=D.request(config({fc:'1',quantity:'000A',start:'0020'}),source());
  const coilReply=M.buildResponse({base:10,slave:'1',fc:'1',values:'1,0,1,0,1,0,1,0,0,1'});
  const coil=D.match(req,coilReply).record;const pt=rule({type:'BOOL',offset:'9'});
  assert.equal(D.view(coil,pt).value,'1');assert.equal(D.mark(coil,pt).point.address,41);
  assert.throws(()=>D.view(rec,rule({offset:'3',type:'FLOAT32'})),/范围/);
});
test('64-bit values retain integer precision and all packet orders can be marked',()=>{
  const req=D.request(config(),source()),p=M.buildResponse({base:10,slave:'1',fc:'3',rows:[{type:'UINT64',order:'ABCD',value:'18446744073709551615'}]});
  const rec=D.match(req,p).record;assert.equal(D.view(rec,rule({type:'UINT64'})).value,'18446744073709551615');
  assert.equal(D.mark(rec,rule({type:'UINT64',order:'CDAB'})).point.order,'CDAB');
});
test('marks persist across RTU and TCP and repeated physical definitions are deduplicated',()=>{
  const rtu=read(),tcp=read({transport:'tcp'},{device:'127.0.0.1/502',endpoint:'127.0.0.1:502'}),store=new D.MarkStore();
  const a=D.mark(rtu,rule()),b=D.mark(tcp,rule());store.upsert(a);store.upsert(a);store.upsert(b);
  assert.equal(store.items.length,2);assert.notEqual(store.items[0].point.name,store.items[1].point.name);
  const restored=new D.MarkStore(JSON.parse(JSON.stringify(store.save())));assert.equal(restored.items.length,2);assert(restored.has(a.point));
  const csv=restored.csv();assert(csv.includes('device')&&!csv.includes('point_data_type'));assert(csv.includes('127.0.0.1/502'));assert(csv.includes('/dev/ttyS0/9600/N'));assert(!csv.includes('observed'));
  restored.rename(restored.items[0].key,'water_temperature');assert.equal(restored.items[0].point.name,'water_temperature');
  restored.remove(restored.items[0].key);assert.equal(restored.items.length,1);
});
test('export-address override is explicit and does not alter the observed request source',()=>{
  const rec=read(),mark=D.mark(rec,rule(),'/dev/ttyUSB0/19200/E');assert.equal(mark.point.device,'/dev/ttyUSB0/19200/E');assert.equal(mark.observed.endpoint,'/dev/ttyS0');
  assert.throws(()=>D.mark(rec,rule(),''),/设备地址/);
});
test('scanner reference addresses remain separate from zero-based exported addresses',()=>{
  assert.equal(D.referenceAddress(3,0),'40001');assert.equal(D.referenceAddress(4,15),'30016');assert.equal(D.referenceAddress(1,0),'00001');assert.equal(D.referenceAddress(2,9),'10010');assert.equal(D.referenceAddress(3,65535),'465536');
  const rec=read();assert.equal(D.referenceAddress(3,D.view(rec,rule()).address),'40017');assert.equal(D.mark(rec,rule()).point.address,16);
});
test('scanner HEX and BIN display raw bits and preserve 64-bit precision',()=>{
  const rec=read();assert.equal(D.displayValue(rec,rule(),'HEX'),'000A');assert.equal(D.displayValue(rec,rule(),'BIN'),'0000 0000 0000 1010');
  const req=D.request(config(),source()),packet=M.buildResponse({base:10,slave:'1',fc:'3',rows:[{type:'UINT64',order:'ABCD',value:'18446744073709551615'}]});const full=D.match(req,packet).record;
  assert.equal(D.displayValue(full,rule({type:'UINT64'}),'HEX'),'FFFFFFFFFFFFFFFF');assert.throws(()=>D.displayValue(rec,rule({type:'FLOAT32'}),'HEX'),/浮点/);
});
function mixedRecord(words=[7,65535,65534,0x3fc0,0,0x8001,99,88],options={}){
  const req=D.request(config({base:10,start:'100',quantity:String(words.length),...options}),source({endpoint:'COM4',device:'COM4'}));return D.match(req,reply(req,words)).record;
}
test('mixed pins decode different word widths and multiple bits while suppressing covered raw cells',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();
  for(const r of [rule({name:'count',offset:'0'}),rule({name:'signed',offset:'1',type:'INT32'}),rule({name:'temperature',offset:'3',type:'FLOAT32'}),rule({name:'low',offset:'5',type:'BIT',bit:0}),rule({name:'high',offset:'5',type:'BIT',bit:15})])pins.pin(rec,r);
  const full=D.mixedLayout(rec,pins),layout=full.filter(r=>!r.expanded);assert.equal(full.filter(r=>r.type==='BIT').length,16);assert.deepEqual(layout.map(r=>[r.offset,r.type]),[['0','UINT16'],['1','INT32'],['3','FLOAT32'],['5','BIT'],['5','BIT'],['6','UINT16'],['7','UINT16']]);
  assert.deepEqual(layout.map(r=>D.displayValue(rec,r,'MIXED')),['7','-2','1.5','1','1','99','88']);assert.deepEqual(pins.range({transport:'rtu',device:'COM4',slave:1,fc:3}),{start:100,quantity:6});
});
test('fixed points survive JSON restore and remain scoped to endpoint, transport, unit and function',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();pins.pin(rec,rule({offset:'3',type:'FLOAT32',order:'ABCD',factor:'2',constant:'1'}));
  const restored=new D.PinStore(JSON.parse(JSON.stringify(pins.save())));assert.equal(restored.dropped,0);assert.equal(D.view(rec,D.mixedLayout(rec,restored).find(r=>r.pinKey)).value,'4');
  for(const change of [{transport:'tcp'},{slave:2},{fc:4}])assert.equal(restored.list({transport:'rtu',device:'COM4',slave:1,fc:3,...change}).length,0);
  assert.equal(restored.list({transport:'rtu',device:'COM5',slave:1,fc:3}).length,0);
  const snapshot=restored.save();snapshot[0].address=65535;assert.equal(restored.save()[0].address,103);
});
test('changing the read window preserves absolute pin addresses and never decodes partial values',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();pins.pin(rec,rule({offset:'1',type:'INT32'}));pins.pin(rec,rule({offset:'3',type:'FLOAT32'}));
  const moved=mixedRecord([65534,0x3fc0,0,0x8001],{start:'102'}),layout=D.mixedLayout(moved,pins);
  assert.equal(layout.filter(r=>r.pinKey).length,1);assert.equal(D.view(moved,layout.find(r=>r.pinKey)).address,103);assert.equal(D.view(moved,layout.find(r=>r.pinKey)).value,'1.5');
  const partial=mixedRecord([7,65535],{start:'100'}),incomplete=D.mixedLayout(partial,pins).find(r=>r.pinKey);assert(incomplete);assert.throws(()=>D.view(partial,incomplete),/范围/);assert.throws(()=>D.mark(partial,incomplete),/范围/);assert.equal(pins.save().length,2);
  pins.put({...pins.save()[0],address:1000,name:'far'});assert.throws(()=>pins.range({transport:'rtu',device:'COM4',slave:1,fc:3}),/单次读取上限/);
});
test('fixed bit edits, normalization and marks preserve the bit identity and byte order',()=>{
  const rec=mixedRecord(),pins=new D.PinStore(),key=pins.pin(rec,rule({offset:'5',type:'BIT',bit:0}));
  pins.pin(rec,rule({offset:'5',type:'BIT',bit:15}));assert.equal(pins.items.length,2);assert.throws(()=>pins.update(key,{bit:15}),/已有固定点/);assert.throws(()=>pins.update(key,{bit:16}),/位号/);
  const changed=pins.update(key,{name:'new_name',bit:1});assert.notEqual(changed,key);assert.equal(D.view(rec,D.pinRule(pins.items[0],rec)).value,'0');
  const store=new D.MarkStore();for(const p of pins.items)store.upsert(D.mark(rec,D.pinRule(p,rec)));
  const saved=new D.MarkStore(JSON.parse(JSON.stringify(store.save())));assert.equal(saved.items.length,2);assert(saved.csv().includes('bit_index'));assert(saved.csv().includes('"BIT","1","ABCD"'));
  const swapped=rule({offset:'5',type:'BIT',bit:7,order:'BADC'});assert.equal(D.view(rec,swapped).value,'1');assert.equal(D.view(rec,{...swapped,bit:0}).value,'0');
  assert.equal(new D.PinStore([{...pins.save()[0],name:'=bad'},{...pins.save()[0],bit:99}]).dropped,2);
});
test('flow monitor keeps wide points intact and represents a bit register as one compact stack',()=>{
  const rec=mixedRecord(),definitions=[rule({offset:'0'}),rule({offset:'1',type:'INT32'}),rule({offset:'5',type:'BIT',bit:0}),rule({offset:'5',type:'BIT',bit:15}),rule({offset:'3',type:'FLOAT64'})];
  const map=D.monitorLayout(rec,definitions,8);assert.equal(map.columns,16);assert.deepEqual(map.items.map(i=>i.span),[4,8,4,16]);assert.equal(map.items[2].kind,'stack');assert.deepEqual(map.items[2].indices,[2,3]);assert.equal(map.items[3].index,4);
});
test('register expansion restores all sixteen bits without persisting generated definitions',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();pins.pin(rec,rule({offset:'5',type:'BIT',bit:15,factor:'2',constant:'1'}));pins.pin(rec,rule({offset:'5',type:'UINT16'}));
  const layout=D.mixedLayout(rec,pins),bits=layout.filter(r=>r.offset==='5');assert.equal(bits.length,16);assert.deepEqual(bits.map(r=>Number(r.bit)),Array.from({length:16},(_,i)=>i));assert.equal(bits.filter(r=>r.pinKey).length,1);assert.equal(D.view(rec,bits[15]).value,'3');assert.equal(pins.save().length,2);assert.equal(D.layout(rec,'BIT').length,128);
  assert.equal(D.scaleLabel(rule()),'');assert.equal(D.scaleLabel(rule({factor:'0.1'})),'×0.1');assert.equal(D.scaleLabel(rule({factor:'2',constant:'-3'})),'×2 -3');
});
test('32/64-bit edits consume following register cards and narrowing restores their definitions',()=>{
  const rec=mixedRecord(),sourceRules=D.layout(rec);sourceRules[1].name='keep_this_name';sourceRules[0].type='INT32';
  let visible=D.resolveLayout(rec,sourceRules);assert.deepEqual(visible.map(r=>r.offset),['0','2','3','4','5','6','7']);assert.equal(sourceRules.length,8);assert(!visible.some(r=>r.offset==='1'));
  sourceRules[0].type='UINT64';visible=D.resolveLayout(rec,sourceRules);assert.deepEqual(visible.map(r=>r.offset),['0','4','5','6','7']);assert.equal(typeof D.view(rec,visible[0]).raw,'string');
  sourceRules[0].type='UINT16';visible=D.resolveLayout(rec,sourceRules);assert.deepEqual(visible.map(r=>r.offset),['0','1','2','3','4','5','6','7']);assert.equal(visible[1].name,'keep_this_name');
});
test('overlapping saved points stay saved while the wide owner covers their module positions',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();pins.pin(rec,rule({offset:'0',type:'INT32'}));pins.pin(rec,rule({offset:'1',name:'second'}));pins.pin(rec,rule({offset:'1',name:'second_bit',type:'BIT',bit:2}));const snapshot=JSON.stringify(pins.save());
  const visible=D.mixedLayout(rec,pins);assert(!visible.some(r=>r.offset==='1'));assert.equal(JSON.stringify(pins.save()),snapshot);assert.equal(pins.items.length,3);
  const partial=mixedRecord([7,1]),wide=rule({offset:'0',type:'FLOAT64'}),partialRules=D.resolveLayout(partial,[wide,rule({offset:'1'})]);assert.equal(partialRules.length,1);assert.throws(()=>D.view(partial,partialRules[0]),/范围/);
  const overlap=D.resolveLayout(rec,[rule({offset:'0',type:'INT32'}),rule({offset:'1',type:'FLOAT64'})]);assert.deepEqual(overlap.map(r=>r.offset),['0','2','3','4','5','6','7']);
});
test('bit groups start collapsed, expand as one framed group, and never mutate point definitions',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();pins.pin(rec,rule({offset:'5',type:'BIT',bit:15}));const rules=D.mixedLayout(rec,pins),before=JSON.stringify(rules),folded=D.monitorLayout(rec,rules),key=folded.groups[0].key;
  const stack=folded.items.find(i=>i.kind==='stack');assert.equal(stack.span,4);assert.equal(stack.indices.length,16);assert.equal(folded.items.filter(i=>i.kind==='group').length,0);
  const open=new Set([key]),expanded=D.monitorLayout(rec,rules,16,open),group=expanded.items.find(i=>i.kind==='group');assert.equal(group.span,16);assert.deepEqual(group.indices,stack.indices);assert.equal(expanded.items.filter(i=>i.kind==='point').length,7);
  assert.deepEqual(D.monitorLayout(rec,rules,16,open).items,expanded.items);open.delete(key);assert.deepEqual(D.monitorLayout(rec,rules,16,open).items,folded.items);assert.equal(JSON.stringify(rules),before);
  assert.deepEqual(D.monitorLayout(rec,rules).items,folded.items);
});
test('expanded bit frames stay within narrow grids and each register toggles independently',()=>{
  const rec=mixedRecord(),pins=new D.PinStore();for(const offset of ['4','5'])pins.pin(rec,rule({offset,type:'BIT',bit:0}));const rules=D.mixedLayout(rec,pins),keys=D.monitorLayout(rec,rules).groups.map(g=>g.key);
  for(const columns of [4,8,12,16,24]){const map=D.monitorLayout(rec,rules,columns,new Set([keys[0]])),group=map.items.find(i=>i.kind==='group'),stack=map.items.find(i=>i.kind==='stack');assert.equal(group.span,Math.min(16,columns));assert.equal(map.columns,columns);assert.equal(group.indices.length,16);assert.equal(stack.key,keys[1]);assert.equal(stack.span,4);}
  const all=D.monitorLayout(rec,rules,16,new Set(keys));assert.equal(all.items.filter(i=>i.kind==='group').length,2);assert.equal(all.items.filter(i=>i.kind==='stack').length,0);
});
test('folded groups follow absolute addresses and stay isolated by device, unit and function',()=>{
  const rec=mixedRecord(),key=D.bitGroupKey(rec,rule({offset:'5',type:'BIT',bit:0})),moved=mixedRecord([1,2,3],{start:'104'});assert.equal(D.bitGroupKey(moved,rule({offset:'1',type:'BIT',bit:0})),key);
  for(const change of [{slave:2},{fc:4},{transport:'tcp'},{source:{endpoint:'COM5'}}])assert.notEqual(D.bitGroupKey({...rec,request:{...rec.request,...change}},rule({offset:'5',type:'BIT'})),key);
});
test('coil and discrete-input layouts retain native addresses and use compact bit blocks',()=>{
  for(const fc of ['1','2']){const req=D.request(config({base:10,fc,start:'65000',quantity:'65'}),source()),packet=M.buildResponse({base:10,slave:'1',fc,values:Array(65).fill(1).join(',')}),rec=D.match(req,packet).record;
    const rules=D.layout(rec),map=D.monitorLayout(rec,rules);assert.equal(map.items.length,65);assert(map.items.every(i=>i.span===1));assert.equal(D.view(rec,rules[64]).address,65064);
  }
});
test('bounded expressions evaluate booleans, text, arithmetic and lazy Python conditions',()=>{
  const examples=[['"true" if v != 0 else "false"',{v:1},'true'],['"true" if v != 0 else "false"',{v:0},'false'],['v != 0',{v:1},true],['v != 0',{v:0},false],['v*2+raw',{v:1.5,raw:3},6],['"运行" if x else "停止"',{v:0},'停止'],['1 if v == 0 else 1/v',{v:0},1],['v != 0 and 10/v > 1',{v:0},false],['-2**2',{},-4],['-7//3',{},-3],['-7%3',{},2],['1 < v < 4',{v:3},true],['max(abs(v), int(2.9))',{v:-3},3],['str(False)',{},'False'],['false or true',{},true]];
  for(const [expr,values,expected] of examples)assert.equal(D.evaluateExpression(expr,values),expected,expr);
  assert.equal(D.evaluateExpression('v+1',{v:'18446744073709551615'}),18446744073709551616n);assert.throws(()=>D.evaluateExpression('v/2',{v:'18446744073709551615'}),/大整数/);
  for(const expr of ['window.alert(1)','v.constructor','__import__("os")','[v][0]','v=2','abs.constructor(1)','v;1','1e999','1/0','2**33','('.repeat(40)+'v'+')'.repeat(40),'v'.repeat(513)])assert.throws(()=>D.evaluateExpression(expr,{v:1}),undefined,expr);
});
test('marked lists retain expressions and update only verified complete points from the original device',()=>{
  const rec=mixedRecord(),store=new D.MarkStore(),marked=D.mark(rec,rule({offset:'1',type:'INT32',name:'signed'}),'1/9600/N');store.upsert(marked);const key=store.items[0].key;store.setExpression(key,'"true" if v != 0 else "false"');
  store.upsert(marked);assert.equal(store.items[0].expression,'"true" if v != 0 else "false"');const newer=mixedRecord([7,0,42,0,0,0,0,0]);assert.equal(store.observe(newer),1);assert.equal(store.items[0].observed.value,'42');assert.equal(store.items[0].observed.raw,'42');
  for(const q of [{slave:'2'},{fc:'4'},{transport:'tcp'}])assert.equal(store.observe(mixedRecord(undefined,q)),0);
  assert.equal(store.observe({...newer,request:{...newer.request,source:{endpoint:'COM9'}}}),0);assert.equal(store.observe(mixedRecord([7,1])),0);assert.equal(store.items[0].observed.value,'42');assert.equal(store.observe({...newer,verified:false}),0);
  const restored=new D.MarkStore(JSON.parse(JSON.stringify(store.save())));assert.equal(restored.dropped,0);assert.equal(restored.items[0].expression,store.items[0].expression);assert(restored.csv().includes('"expression"'));assert.equal(D.evaluateExpression(restored.items[0].expression,{v:restored.items[0].observed.value}),'true');
  assert.throws(()=>store.setExpression(key,'v +'),/完整|名称/);assert.throws(()=>store.setExpression(key,'1e999'),/有限/);assert.equal(store.items[0].expression,restored.items[0].expression);assert.equal(new D.MarkStore([{...store.save()[0],expression:'evil(v)'}]).dropped,1);
});
test('gateway expressions compose bit extraction, scaling and text conversion exactly once',()=>{
  const point=D.mark(mixedRecord(),rule({offset:'5',type:'BIT',bit:15,factor:'2',constant:'-1'})).point;
  const expression=D.gatewayExpression('"true" if v == 1 else "false"',point);assert(expression.includes('v//32768'));assert(expression.includes('*2+-1'));assert(!expression.includes('raw'));assert.equal(D.gatewayExpression('2',point),'(2)');
  assert.equal(D.gatewayExpression('',point),'');assert(D.gatewayExpression('raw',point).includes('v//32768'));assert(!D.gatewayExpression('raw',point).includes('*2'));
});
