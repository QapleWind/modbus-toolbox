'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ModbusPoints=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const TYPES=Object.freeze(Object.fromEntries([['BOOL',1],['BIT',1],['INT16',1],['UINT16',1],['INT32',2],['UINT32',2],['FLOAT32',2],['INT64',4],['UINT64',4],['FLOAT64',4]].map(([type,words])=>[type,Object.freeze({words})])));
  const ORDERS=Object.freeze(['ABCD','BADC','CDAB','DCBA']);
  const FIELDS=Object.freeze(['name','transport','device','slave_id','function_code','address','data_type','register_count','byte_order','factor','constant']);
  function integer(value,base,min,max,label){
    const text=String(value??'').trim();
    if(![10,16].includes(base)||!(base===16?/^(?:0x)?[0-9a-f]+$/i:/^\d+$/).test(text))throw Error(`${label}请输入${base===16?'十六进制':'十进制'}整数。`);
    const n=parseInt(text.replace(/^0x/i,''),base);
    if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${label}范围为 ${min}–${max}。`);return n;
  }
  function number(value,label){
    const text=String(value??'').trim();
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)||!Number.isFinite(Number(text)))throw Error(`${label}请输入有限数值。`);return Number(text);
  }
  function safeText(value,label,max=128){
    const text=String(value??'').trim();
    if(!text||text.length>max||/[\x00-\x1f\x7f]/.test(text))throw Error(`${label}不能为空，最多 ${max} 字符，且不能包含换行或控制字符。`);
    if(/^[=+\-@]/.test(text))throw Error(`${label}不能以 =、+、-、@ 开头。`);return text;
  }
  function scale(factor,constant){const f=number(factor,'系数'),c=number(constant,'常数');return c===0?String(f):`v*${f}${c<0?'':'+'}${c}`;}
  function tcpDevice(host,port){
    const ip=String(host).trim(),parts=ip.split('.');
    if(parts.length!==4||parts.some(n=>!/^\d{1,3}$/.test(n)||Number(n)>255))throw Error('设备地址请填写 IPv4，例如 192.0.2.10。');
    return ip+':'+integer(port,10,1,65535,'TCP 端口');
  }
  function normalize(point){
    const transport=point.transport,type=point.type;
    if(!['rtu','tcp'].includes(transport))throw Error('请选择 RTU 或 TCP 连接。');
    if(!Object.hasOwn(TYPES,type))throw Error('请选择支持的数据类型。');
    if(!ORDERS.includes(point.order))throw Error('请选择有效字节序。');
    const fc=integer(point.fc,10,1,4,'读取功能码'),address=integer(point.address,10,0,65535,'寄存器/线圈地址');
    if((fc<=2)!==(type==='BOOL'))throw Error('功能码 01/02 使用 BOOL；03/04 使用寄存器数值类型。');
    if(address+TYPES[type].words>65536)throw Error('数据类型占用的地址超出 65535。');
    return {transport,device:safeText(point.device,'设备地址',256),slave:integer(point.slave,10,transport==='rtu'?1:0,transport==='rtu'?247:255,'子站号'),fc,name:safeText(point.name,'点名'),address,type,order:type==='BOOL'?'ABCD':point.order,factor:String(number(point.factor,'系数')),constant:String(number(point.constant,'常数')),...(type==='BIT'?{bit:integer(point.bit??0,10,0,15,'位号')}: {})};
  }
  function requestContext(request){
    const base=Number(request.base),transport=request.transport==='tcp'?'tcp':'rtu',fc=integer(request.fc,10,1,4,'读取功能码');
    const slave=integer(request.slave,base,transport==='rtu'?1:0,transport==='rtu'?247:255,'子站号'),start=integer(request.start,base,0,65535,'请求起始地址'),quantity=integer(request.quantity,base,1,fc<=2?2000:125,'请求读取数量');
    if(start+quantity>65536)throw Error('请求读取范围超出 65535。');return {transport,slave,fc,start,quantity};
  }
  function csv(rows){
    if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw Error('点表需要 1–5000 个点位。');
    const hasBits=rows.some(p=>p.type==='BIT'),names=new Set(),values=rows.map(row=>{const p=normalize(row);if(names.has(p.name))throw Error(`点名重复：${p.name}。`);names.add(p.name);return [p.name,p.transport,p.device,p.slave,p.fc,p.address,p.type,TYPES[p.type].words,p.order,p.factor,p.constant,...(hasBits?[p.type==='BIT'?p.bit:'']:[])];});
    return '\uFEFF'+[hasBits?[...FIELDS,'bit_index']:FIELDS,...values].map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
  }
  return {TYPES,ORDERS,FIELDS,integer,scale,tcpDevice,normalize,requestContext,csv};
});
