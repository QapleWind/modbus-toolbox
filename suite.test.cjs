const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./transports.js');
const req={base:16,slave:'01',fc:'3',start:'0000',quantity:'0002',transaction:'0001'};
const res={base:16,slave:'01',fc:'3',transaction:'0001',rows:[{type:'UINT16',order:'ABCD',value:'1'},{type:'UINT16',order:'ABCD',value:'2'}]};
test('TCP fixed vectors and MBAP fields',()=>{
  const a=M.buildPacket(req,'request','tcp'),b=M.buildPacket(res,'response','tcp');
  assert.equal(M.hex(a),'00 01 00 00 00 06 01 03 00 00 00 02');
  assert.equal(M.hex(b),'00 01 00 00 00 07 01 03 04 00 01 00 02');
  assert.equal(M.parsePacket(b,'response','tcp').transaction,1);
  assert.equal(M.parsePacket(b,'response','tcp').checkName,'MBAP');
  for(const slave of ['00','FF'])assert.equal(M.parsePacket(M.buildPacket({...req,slave},'request','tcp'),'request','tcp').slave,parseInt(slave,16));
});
test('TCP rejects incorrect length and nonzero protocol identifiers',()=>{
  assert.throws(()=>M.parsePacket('00 01 00 00 00 07 01 03 00 00 00 02','request','tcp'));
  assert.throws(()=>M.parsePacket('00 01 00 01 00 06 01 03 00 00 00 02','request','tcp'));
});
test('ASCII LRC vectors and error detection',()=>{
  assert.equal(M.buildPacket(req,'request','ascii'),':010300000002FA\r\n');
  assert.equal(M.buildPacket(res,'response','ascii'),':01030400010002F5\r\n');
  const parsed=M.parsePacket(':01030400010002F5','response','ascii');
  assert.equal(parsed.crcValid,true);assert.equal(M.hex(parsed.data),'00 01 00 02');
  assert.equal(M.parsePacket(':01030400010002F4','response','ascii').crcValid,false);
  assert.throws(()=>M.parsePacket('01030400010002F5','response','ascii'));
});
test('read and write pairing across three transports detects mismatches',()=>{
  for(const transport of ['rtu','tcp','ascii']){
    const a=M.packetText(M.buildPacket(req,'request',transport)),b=M.packetText(M.buildPacket(res,'response',transport));
    assert.equal(M.compareFrames(a,b,transport).valid,true);
    const other=M.packetText(M.buildPacket({...res,slave:'02'},'response',transport));assert.equal(M.compareFrames(a,other,transport).valid,false);
    const short=M.packetText(M.buildPacket({...res,rows:res.rows.slice(0,1)},'response',transport));assert.equal(M.compareFrames(a,short,transport).valid,false);
  }
  const a=M.hex(M.buildPacket(req,'request','tcp')),b=M.hex(M.buildPacket({...res,transaction:'0002'},'response','tcp'));assert.equal(M.compareFrames(a,b,'tcp').valid,false);
  const write={...req,fc:'6',value:'0001'};assert.equal(M.compareFrames(M.hex(M.buildPacket(write,'request')),M.hex(M.buildPacket(write,'response'))).valid,true);
});
test('large integer conversion preserves precision, sign and strict radix',()=>{
  assert.equal(M.bigintInput('18446744073709551615',10),0xFFFFFFFFFFFFFFFFn);
  assert.equal(M.bigintInput('-0xFF',16),-255n);assert.equal(M.bigintInput('0b11111111',2),255n);assert.equal(M.bigintInput('377',8),255n);
  for(const [text,base]of[['2',2],['0xFF',10],['1.2',10],['',16],['0o10',16]])assert.throws(()=>M.bigintInput(text,base));
});
test('reference-address conversions cover zero/one bases and both widths',()=>{
  assert.equal(M.referenceAddress('40001',4,5,'reference').offset,'0');
  assert.equal(M.referenceAddress('400001',4,6,'reference').hex,'0000');
  assert.equal(M.referenceAddress('FFFF',4,6,'hex').reference,'465536');
  assert.equal(M.referenceAddress('1',0,5,'one').reference,'00001');
  assert.equal(M.referenceAddress('9999',4,5,'zero').reference.includes('超出'),true);
  assert.throws(()=>M.referenceAddress('30001',4,5,'reference'));assert.throws(()=>M.referenceAddress('65536',4,6,'zero'));
});
