const {test}=require('node:test'),assert=require('node:assert/strict');
const {SerialPicker}=require('./serial-picker.cjs');
const ports=[{portId:'a',portName:'COM3',displayName:'USB Serial'},{portId:'b',portName:'COM7'}];
test('discovery cancels the Chromium chooser without opening a device and shares concurrent scans',async()=>{
  const picker=new SerialPicker(),selected=[];
  const contents={executeJavaScript(code,gesture){assert(code.includes('requestPort'));assert.equal(gesture,true);queueMicrotask(()=>picker.select(ports,contents,id=>selected.push(id)));return Promise.resolve();}};
  const a=picker.list(contents),b=picker.list(contents);assert.equal(a,b);
  assert.deepEqual(await a,[{id:'a',name:'USB Serial',path:'COM3',vendor:'',product:''},{id:'b',name:'COM7',path:'COM7',vendor:'',product:''}]);assert.deepEqual(selected,['']);
});
test('only the dropdown-selected port in the latest list can be granted, once, to its window',()=>{
  const picker=new SerialPicker(),windowA={},windowB={};picker.ports=ports;let chosen='';
  assert.throws(()=>picker.prepare('missing',windowA),/不可用/);
  picker.prepare('b',windowA);picker.select(ports,windowA,id=>chosen=id);assert.equal(chosen,'b');
  picker.select(ports,windowA,id=>chosen=id);assert.equal(chosen,'');
  picker.prepare('a',windowA);picker.select(ports,windowB,id=>chosen=id);assert.equal(chosen,'');
  picker.prepare('a',windowA);picker.select([ports[1]],windowA,id=>chosen=id);assert.equal(chosen,'');
});
test('an enumeration failure can recover and closing cancels pending discovery',async()=>{
  const picker=new SerialPicker();await assert.rejects(picker.list({executeJavaScript(){return Promise.reject(Error('unavailable'));}}),/unavailable/);
  const pending=picker.list({executeJavaScript(){return Promise.resolve();}});picker.close();await assert.rejects(pending,/取消/);assert.equal(picker.scan,null);
});
test('an explicit dropdown selection waits for an in-flight discovery and revalidates the list',async()=>{
  const picker=new SerialPicker(),contents={executeJavaScript(){return Promise.resolve();}};
  const discovery=picker.list(contents),selection=picker.prepare('b',contents);let chosen='';picker.select(ports,contents,id=>chosen=id);assert.equal(chosen,'');await discovery;await selection;picker.select(ports,contents,id=>chosen=id);assert.equal(chosen,'b');
});
