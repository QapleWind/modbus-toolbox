'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./transports.js'),require('./modbus-points.js'));else root.ModbusDebug=factory(root.Modbus,root.ModbusPoints);})(typeof globalThis!=='undefined'?globalThis:this,function(M,P){
  const ensure=(yes,message)=>{if(!yes)throw Error(message);};
  function request(config,source,transaction=1){
    const transport=config.transport,base=Number(config.base);
    ensure(['rtu','tcp'].includes(transport),'请选择 RTU 或 TCP。');
    const slave=M.integer(config.slave,10,transport==='rtu'?1:0,transport==='rtu'?247:255,'子站号');
    const fc=M.integer(config.fc,10,1,16,'功能码'),start=M.integer(config.start,base,0,65535,'起始协议地址');
    ensure(Object.hasOwn(M.FUNCTIONS,fc),'不支持的功能码。');
    const c={base:10,slave:String(slave),fc:String(fc),start:String(start),transaction:String(transaction)};
    if(fc<=4)c.quantity=String(M.integer(config.quantity,base,1,fc<=2?2000:125,'读取数量'));
    else if(fc===5)c.coil=config.coil;
    else if(fc===6)c.value=String(M.integer(config.quantity,base,0,65535,'写入值'));
    else c.values=M.listValues(config.values,fc===15,base).join(',');
    const bytes=Array.from(M.buildPacket(c,'request',transport));
    const quantity=fc<=4?Number(c.quantity):fc<=6?1:M.listValues(c.values,fc===15,10).length;
    return Object.freeze({transport,slave,fc,start,quantity,transaction,bytes:Object.freeze(bytes),source:Object.freeze({...source}),sentAt:new Date().toISOString()});
  }
  function match(req,bytes){
    let res;try{res=M.parsePacket(bytes,'response',req.transport);}catch(error){return {kind:'ignore',reason:error.message};}
    if(!res.crcValid||res.slave!==req.slave||(res.fc&127)!==req.fc||(req.transport==='tcp'&&res.transaction!==req.transaction))return {kind:'ignore',reason:'设备、功能码、事务 ID 或校验不匹配'};
    if(res.fc&128)return {kind:'exception',reason:res.exception};
    const check=M.compareFrames(Uint8Array.from(req.bytes),bytes,req.transport);
    if(!check.valid)return {kind:'ignore',reason:check.checks.filter(c=>!c.valid).map(c=>c.name).join('、')};
    return req.fc<=4?{kind:'read',record:Object.freeze({request:req,data:Object.freeze(Array.from(res.data)),bytes:Object.freeze(Array.from(res.bytes)),receivedAt:new Date().toISOString(),verified:true})}:{kind:'write'};
  }
  class FrameStream{
    constructor(transport){this.transport=transport;this.buffer=[];}
    clear(){this.buffer=[];}
    push(chunk){
      this.buffer.push(...chunk);if(this.buffer.length>65536)this.buffer=this.buffer.slice(-65536);
      const packets=[];let i=0,keep=-1;
      while(i+(this.transport==='tcp'?7:5)<=this.buffer.length){
        const b=this.buffer;let size=0;
        if(this.transport==='tcp'){
          const length=b[i+4]*256+b[i+5];
          if(b[i+2]!==0||b[i+3]!==0||length<2||length>254){i++;continue;}
          size=length+6;
        }else{const fc=b[i+1];size=fc&128?5:[1,2,3,4].includes(fc)?b[i+2]+5:[5,6,15,16].includes(fc)?8:0;if(!size||size>256){i++;continue;}}
        if(i+size>b.length){if(keep<0)keep=i;if(this.transport==='tcp')break;i++;continue;}
        const packet=Uint8Array.from(b.slice(i,i+size));
        try{const p=M.parsePacket(packet,'response',this.transport);if(p.crcValid){packets.push(packet);i+=size;keep=-1;continue;}}catch(_){}
        i++;
      }
      this.buffer=this.buffer.slice(keep>=0?keep:i);return packets;
    }
  }
  function layout(record,type='UINT16',order='ABCD'){
    const r=record.request,bit=r.fc<=2;if(bit)type='BOOL';
    const width=P.TYPES[type]?.words;ensure(width,'无效的数据类型。');
    ensure(bit===(type==='BOOL'),'线圈使用 BOOL，寄存器使用数值类型。');
    ensure(r.quantity%width===0,'读取数量不能按此类型完整拆分，请调整类型或规则。');
    const rules=Array.from({length:r.quantity/width},(_,i)=>({name:`point_${r.slave}_${r.fc}_${r.start+i*width}`,offset:String(i*width),type,bit:0,order:bit?'ABCD':order,factor:'1',constant:'0'}));
    return type==='BIT'?expandBits(rules):rules;
  }
  function view(record,rule){
    ensure(record?.verified,'尚未收到与请求匹配的有效响应。');
    const r=record.request,bit=r.fc<=2,offset=M.integer(rule.offset,10,0,r.quantity-1,'点偏移');
    ensure(Object.hasOwn(P.TYPES,rule.type),'无效数据类型。');
    ensure(bit===(rule.type==='BOOL'),'线圈使用 BOOL，寄存器使用数值类型。');
    const width=P.TYPES[rule.type].words;ensure(offset+width<=r.quantity,'此点超出最近一次响应的读取范围。');
    let raw=bit?((record.data[Math.floor(offset/8)]>>(offset%8))&1):M.decode(record.data.slice(offset*2,(offset+width)*2),rule.type==='BIT'?'UINT16':rule.type,rule.order);
    if(rule.type==='BIT')raw=(raw>>>P.integer(rule.bit??0,10,0,15,'位号'))&1;
    const scale=P.scale(rule.factor,rule.constant),f=Number(rule.factor),c=Number(rule.constant);
    const value=typeof raw==='bigint'&&f===1&&c===0?raw.toString():String(Number(raw)*f+c);
    return {address:r.start+offset,raw:String(raw),value,scale,bytes:bit?String(raw):M.hex(record.data.slice(offset*2,(offset+width)*2))};
  }
  function mark(record,rule,deviceOverride){
    const v=view(record,rule),r=record.request;
    const point=P.normalize({transport:r.transport,device:deviceOverride??r.source.device,slave:r.slave,fc:r.fc,address:v.address,type:rule.type,bit:rule.bit,order:rule.type==='BOOL'?'ABCD':rule.order,factor:rule.factor,constant:rule.constant,name:rule.name});
    return {point,observed:{time:record.receivedAt,value:v.value,raw:v.raw,endpoint:r.source.endpoint,demo:!!r.source.demo}};
  }
  function identity(point){const p=P.normalize(point);return JSON.stringify([p.transport,p.device,p.slave,p.fc,p.address,p.type,p.order,p.factor,p.constant,...(p.type==='BIT'?[p.bit]:[])]);}
  function pinKey(p){return JSON.stringify([p.transport,p.device,p.slave,p.fc,p.address,p.type==='BIT'?'bit:'+p.bit:'word']);}
  function pinRule(point,record){return {name:point.name,offset:String(point.address-record.request.start),type:point.type,bit:point.bit,order:point.order,factor:point.factor,constant:point.constant,pinKey:pinKey(point)};}
  class PinStore{
    constructor(saved=[]){this.items=[];this.dropped=0;for(const item of Array.isArray(saved)?saved.slice(0,1000):[]){try{this.put(item);}catch(_){this.dropped++;}}if(Array.isArray(saved)&&saved.length>1000)this.dropped+=saved.length-1000;}
    put(point){const p=P.normalize(point),key=pinKey(p),old=this.items.findIndex(x=>pinKey(x)===key);if(old<0){ensure(this.items.length<1000,'固定点最多 1000 个。');this.items.push(p);}else this.items[old]=p;return key;}
    pin(record,rule){const v=view(record,rule),r=record.request;return this.put({...rule,address:v.address,transport:r.transport,device:r.source.endpoint,slave:r.slave,fc:r.fc});}
    update(key,patch){const i=this.items.findIndex(p=>pinKey(p)===key);ensure(i>=0,'固定点不存在。');const old=this.items[i],next=P.normalize({...old,...patch});ensure(!this.items.some((p,j)=>j!==i&&pinKey(p)===pinKey(next)),'该地址和位号已有固定点。');this.items[i]=next;return pinKey(next);}
    remove(key){this.items=this.items.filter(p=>pinKey(p)!==key);}
    list(context){return this.items.filter(p=>p.transport===context.transport&&p.device===context.device&&p.slave===Number(context.slave)&&p.fc===Number(context.fc));}
    forRecord(record){const r=record.request;return this.list({transport:r.transport,device:r.source.endpoint,slave:r.slave,fc:r.fc});}
    save(){return this.items.map(p=>({...p}));}
    range(context){const points=this.list(context);ensure(points.length,'当前设备与数据区没有固定点。');const start=Math.min(...points.map(p=>p.address)),end=Math.max(...points.map(p=>p.address+P.TYPES[p.type].words));ensure(end-start<=(Number(context.fc)<=2?2000:125),'固定点跨度超出单次读取上限，请分段读取。');return {start,quantity:end-start};}
  }
  function mixedLayout(record,store){
    ensure(record?.verified,'尚未收到有效响应。');const q=record.request,points=store.forRecord(record).filter(p=>p.address>=q.start&&p.address<q.start+q.quantity),occupied=new Set(),rules=[];
    for(const p of points){rules.push(pinRule(p,record));for(let i=0;i<P.TYPES[p.type].words;i++)occupied.add(p.address+i);}
    for(let i=0;i<q.quantity;i++)if(!occupied.has(q.start+i))rules.push({name:`point_${q.slave}_${q.fc}_${q.start+i}`,offset:String(i),type:q.fc<=2?'BOOL':'UINT16',order:'ABCD',factor:'1',constant:'0'});
    return resolveLayout(record,rules);
  }
  function expandBits(rules){
    const groups=new Map();for(const rule of rules)if(rule.type==='BIT'){const key=Number(rule.offset);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(rule);}
    const result=rules.filter(r=>!groups.has(Number(r.offset))||P.TYPES[r.type].words>1);
    for(const [offset,points] of groups)for(let bit=0;bit<16;bit++){const stored=points.find(p=>Number(p.bit)===bit),base=points[0];result.push(stored||{name:base.name.replace(/_bit\d+$/,'')+'_bit'+bit,offset:String(offset),type:'BIT',bit,order:base.order,factor:'1',constant:'0',expanded:true});}
    return result.sort((a,b)=>Number(a.offset)-Number(b.offset)||(a.type==='BIT'?1:0)-(b.type==='BIT'?1:0)||(Number(a.bit)||0)-(Number(b.bit)||0));
  }
  function resolveLayout(record,candidates){
    ensure(record?.verified,'尚未收到有效响应。');const q=record.request,occupied=new Set(),bitWords=new Set(),result=[];
    const sorted=expandBits(candidates).sort((a,b)=>Number(a.offset)-Number(b.offset)||P.TYPES[b.type].words-P.TYPES[a.type].words||Number(!!b.pinKey)-Number(!!a.pinKey)||(Number(a.bit)||0)-(Number(b.bit)||0));
    for(const rule of sorted){const start=Number(rule.offset),width=P.TYPES[rule.type].words;if(!Number.isInteger(start)||start<0||start>=q.quantity)continue;
      if(rule.type==='BIT'&&bitWords.has(start)){result.push(rule);continue;}
      if(Array.from({length:Math.min(width,q.quantity-start)},(_,i)=>start+i).some(i=>occupied.has(i)))continue;
      for(let i=0;i<width&&start+i<q.quantity;i++)occupied.add(start+i);if(rule.type==='BIT')bitWords.add(start);result.push(rule);
    }
    for(let i=0;i<q.quantity;i++)if(!occupied.has(i))result.push({name:`point_${q.slave}_${q.fc}_${q.start+i}`,offset:String(i),type:q.fc<=2?'BOOL':'UINT16',order:'ABCD',factor:'1',constant:'0',generated:true});
    return result.sort((a,b)=>Number(a.offset)-Number(b.offset)||(Number(a.bit)||0)-(Number(b.bit)||0));
  }
  function bitGroupKey(record,rule){const q=record.request;return JSON.stringify([q.transport,q.source.endpoint,q.slave,q.fc,q.start+Number(rule.offset)]);}
  function monitorLayout(record,rules,columns=16,expanded=new Set()){
    const groups=[],byKey=new Map();rules.forEach((rule,index)=>{if(rule.type!=='BIT')return;const key=bitGroupKey(record,rule);if(!byKey.has(key)){const group={key,address:record.request.start+Number(rule.offset),indices:[]};groups.push(group);byKey.set(key,group);}byKey.get(key).indices.push(index);});
    const width=Math.max(4,Math.floor(columns/4)*4,...rules.filter(r=>!['BIT','BOOL'].includes(r.type)).map(r=>P.TYPES[r.type].words*4));
    const items=[];rules.forEach((rule,index)=>{const key=rule.type==='BIT'?bitGroupKey(record,rule):null,group=byKey.get(key);if(group){if(group.indices[0]===index)items.push({kind:expanded.has(key)?'group':'stack',index,indices:group.indices,key,span:expanded.has(key)?Math.min(16,width):4});}else items.push({kind:'point',index,span:rule.type==='BOOL'?1:P.TYPES[rule.type].words*4});});
    return {columns:width,items,groups};
  }
  function scaleLabel(rule){const f=Number(rule.factor),c=Number(rule.constant);return f===1&&c===0?'':`×${f}${c?(c>0?' +':' ')+c:''}`;}
  // A bounded Python expression subset, used by live display and CSV export.
  // No eval, dynamic functions, properties, indexing, objects or ambient names.
  function parseExpression(source){
    ensure(typeof source==='string'&&source.length<=512,'表达式最多 512 字符。');const tokens=[];let at=0;
    while(at<source.length){if(/\s/.test(source[at])){at++;continue;}const rest=source.slice(at),number=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest),name=/^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
      if(number){tokens.push({kind:'number',value:number[0]});at+=number[0].length;}
      else if(name){tokens.push({kind:'name',value:name[0]});at+=name[0].length;}
      else if(source[at]==='"'||source[at]==="'"){const quote=source[at++];let value='',closed=false;while(at<source.length){let c=source[at++];if(c===quote){closed=true;break;}if(c==='\\'){ensure(at<source.length,'字符串未结束。');c=source[at++];const escapes={n:'\n',r:'\r',t:'\t','\\':'\\','"':'"',"'":"'"};ensure(Object.hasOwn(escapes,c),'不支持此字符串转义。');c=escapes[c];}ensure(c>=' '||'\n\r\t'.includes(c),'字符串包含控制字符。');value+=c;}ensure(closed,'字符串未结束。');ensure(value.length<=256,'字符串最多 256 字符。');tokens.push({kind:'string',value});}
      else{const op=/^(?:\*\*|\/\/|==|!=|<=|>=|[()+\-*\/%<>,])/.exec(rest);ensure(op,'表达式包含不支持的字符：'+source[at]);tokens.push({kind:'op',value:op[0]});at+=op[0].length;}
      ensure(tokens.length<=256,'表达式过于复杂。');
    }
    let i=0,depth=0;const peek=()=>tokens[i]?.value,take=s=>peek()===s?(i++,true):false,want=s=>ensure(take(s),'缺少 '+s+'。');
    const nested=fn=>{ensure(++depth<=32,'表达式嵌套不能超过 32 层。');try{return fn();}finally{depth--;}};
    function conditional(){return nested(()=>{let yes=or();if(take('if')){const cond=or();want('else');yes={kind:'if',cond,yes,no:conditional()};}return yes;});}
    function or(){let left=and();while(take('or'))left={kind:'binary',op:'or',left,right:and()};return left;}
    function and(){let left=not();while(take('and'))left={kind:'binary',op:'and',left,right:not()};return left;}
    function not(){return take('not')?nested(()=>({kind:'unary',op:'not',arg:not()})):compare();}
    function compare(){const args=[sum()],ops=[];while(['==','!=','<','<=','>','>='].includes(peek())){ops.push(tokens[i++].value);args.push(sum());}return ops.length?{kind:'compare',args,ops}:args[0];}
    function sum(){let left=product();while(['+','-'].includes(peek())){const op=tokens[i++].value;left={kind:'binary',op,left,right:product()};}return left;}
    function product(){let left=unary();while(['*','/','//','%'].includes(peek())){const op=tokens[i++].value;left={kind:'binary',op,left,right:unary()};}return left;}
    function unary(){if(['+','-'].includes(peek())){const op=tokens[i++].value;return nested(()=>({kind:'unary',op,arg:unary()}));}let left=primary();if(take('**'))left={kind:'binary',op:'**',left,right:nested(unary)};return left;}
    function primary(){if(take('(')){const node=conditional();want(')');return node;}const token=tokens[i++];ensure(token,'表达式不完整。');if(token.kind==='number'){ensure(token.value.length<=256,'数值常量过长。');expressionNumber(token.value);return token;}if(token.kind==='string')return token;if(['true','false','True','False'].includes(token.value))return {kind:'boolean',value:token.value.toLowerCase()==='true'};if(['v','x','raw','v0'].includes(token.value))return {kind:'variable',value:token.value};ensure(['abs','min','max','int','float','str'].includes(token.value),'不支持的名称：'+token.value);want('(');const args=[];if(!take(')')){do{args.push(conditional());}while(take(','));want(')');}ensure(args.length>0&&args.length<=16,'函数需要 1–16 个参数。');ensure(['min','max'].includes(token.value)||args.length===1,'此函数只接受一个参数。');return {kind:'call',name:token.value,args};}
    if(!tokens.length)return null;const tree=conditional();ensure(i===tokens.length,'无法识别表达式尾部。');return tree;
  }
  function expressionNumber(value){
    if(typeof value==='bigint'||typeof value==='number'){ensure(typeof value==='bigint'||Number.isFinite(value),'表达式需要有限数值。');return value;}
    if(typeof value==='boolean')return Number(value);const text=String(value??'').trim();ensure(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text),'表达式需要数值。');
    if(/^[+-]?\d+$/.test(text)){const n=BigInt(text);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))return n;}const n=Number(text);ensure(Number.isFinite(n),'表达式需要有限数值。');return n;
  }
  function expressionTruthy(v){return typeof v==='string'?v.length>0:!!v;}
  function expressionMath(op,left,right){
    let a=expressionNumber(left),b=expressionNumber(right);if(op==='**')ensure(b>=0&&b<=32,'幂指数范围为 0–32。');
    if(['+','-','*','//','%','**'].includes(op)&&((typeof a==='bigint'||typeof b==='bigint')||(Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&['+','-','*'].includes(op)))){
      ensure(typeof a==='bigint'||Number.isSafeInteger(a),'大整数运算不能混用小数。');ensure(typeof b==='bigint'||Number.isSafeInteger(b),'大整数运算不能混用小数。');a=BigInt(a);b=BigInt(b);ensure(!['//','%'].includes(op)||b!==0n,'除数不能为 0。');let value;
      if(op==='+')value=a+b;else if(op==='-')value=a-b;else if(op==='*')value=a*b;else if(op==='**')value=a**b;else{const q=a/b,r=a%b,floor=q-(r!==0n&&((a<0n)!==(b<0n))?1n:0n);value=op==='//'?floor:a-floor*b;}
      ensure(value.toString().length<=256,'表达式结果过大。');return value<=BigInt(Number.MAX_SAFE_INTEGER)&&value>=BigInt(Number.MIN_SAFE_INTEGER)?Number(value):value;
    }
    ensure(typeof a!=='bigint'&&typeof b!=='bigint','大整数请使用整数运算或显式 float() 转换。');ensure(!['/','//','%'].includes(op)||b!==0,'除数不能为 0。');let quotient,remainder;
    if(['//','%'].includes(op)){remainder=a%b;quotient=(a-remainder)/b;if(remainder&&((b<0)!==(remainder<0))){remainder+=b;quotient-=1;}const floor=Math.floor(quotient);quotient=floor+(quotient-floor>0.5?1:0);}
    const value=op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:op==='//'?quotient:op==='%'?remainder:a**b;ensure(Number.isFinite(value),'表达式结果不是有限数值。');return value;
  }
  function evaluateExpression(source,values={}){
    const tree=typeof source==='string'?parseExpression(source):source;if(!tree)return String(values.v??'');let steps=0;
    function run(n){ensure(++steps<=512,'表达式过于复杂。');if(n.kind==='number')return expressionNumber(n.value);if(n.kind==='string'||n.kind==='boolean')return n.value;if(n.kind==='variable'){const key=['raw','v0'].includes(n.value)?'raw':'v';ensure(values[key]!==undefined,'尚未读取原始值。');return expressionNumber(values[key]);}
      if(n.kind==='if')return run(expressionTruthy(run(n.cond))?n.yes:n.no);
      if(n.kind==='unary'){const v=run(n.arg);return n.op==='not'?!expressionTruthy(v):n.op==='-'?-expressionNumber(v):expressionNumber(v);}
      if(n.kind==='binary'){const left=run(n.left);if(n.op==='and')return expressionTruthy(left)?run(n.right):left;if(n.op==='or')return expressionTruthy(left)?left:run(n.right);return expressionMath(n.op,left,run(n.right));}
      if(n.kind==='compare'){let a=run(n.args[0]);for(let i=0;i<n.ops.length;i++){let b=run(n.args[i+1]),aa=a,bb=b;if(typeof aa==='boolean')aa=Number(aa);if(typeof bb==='boolean')bb=Number(bb);const sameType=typeof aa===typeof bb||(typeof aa!=='string'&&typeof bb!=='string'),equal=sameType&&aa==bb,op=n.ops[i];ensure(['==','!='].includes(op)||sameType,'不能比较文本与数值。');const yes=op==='=='?equal:op==='!='?!equal:op==='<'?aa<bb:op==='<='?aa<=bb:op==='>'?aa>bb:aa>=bb;if(!yes)return false;a=b;}return true;}
      const args=n.args.map(run);if(n.name==='str')return typeof args[0]==='boolean'?(args[0]?'True':'False'):String(args[0]);if(n.name==='float'){const v=Number(expressionNumber(args[0]));ensure(Number.isFinite(v),'表达式需要有限数值。');return v;}if(n.name==='int'){const v=expressionNumber(args[0]);return typeof v==='bigint'?v:Math.trunc(v);}if(n.name==='abs'){const v=expressionNumber(args[0]);return v<0?-v:v;}return args.map(expressionNumber).reduce((a,b)=>n.name==='min'?(a<b?a:b):(a>b?a:b));
    }
    const result=run(tree);ensure(String(result).length<=256,'表达式结果最多 256 字符。');return result;
  }
  function pythonExpression(source,variables={v:'v',x:'v',raw:'raw',v0:'raw'}){
    const tree=parseExpression(source);if(!tree)return '';
    function emit(n){if(n.kind==='number')return n.value;if(n.kind==='string')return JSON.stringify(n.value);if(n.kind==='boolean')return n.value?'True':'False';if(n.kind==='variable')return '('+variables[n.value]+')';if(n.kind==='if')return `(${emit(n.yes)} if ${emit(n.cond)} else ${emit(n.no)})`;if(n.kind==='unary')return `(${n.op==='not'?'not ':n.op}${emit(n.arg)})`;if(n.kind==='binary')return `(${emit(n.left)} ${n.op} ${emit(n.right)})`;if(n.kind==='compare')return '('+n.args.map((arg,i)=>(i?n.ops[i-1]+' ':'')+emit(arg)).join(' ')+')';return n.name+'('+n.args.map(emit).join(', ')+')';}
    return '('+emit(tree)+')';
  }
  function gatewayExpression(source,point){const p=P.normalize(point),raw=p.type==='BIT'?`((v//${2**p.bit})%2)`:'v',scaled=`(${raw}*${p.factor}+${p.constant})`;return pythonExpression(source,{v:scaled,x:scaled,raw,v0:raw});
  }
  class MarkStore{
    constructor(saved=[]){this.items=[];this.dropped=0;for(const item of Array.isArray(saved)?saved.slice(0,5000):[]){try{this.upsert(item);}catch(_){this.dropped++;}}if(Array.isArray(saved)&&saved.length>5000)this.dropped+=saved.length-5000;}
    has(point){const key=identity(point);return this.items.some(item=>item.key===key);}
    upsert(entry){
      const point=P.normalize(entry.point),key=identity(point),old=this.items.find(item=>item.key===key);
      const expression=entry.expression??old?.expression??'';parseExpression(expression);
      const observed={time:String(entry.observed?.time||'').slice(0,40),value:String(entry.observed?.value??'').slice(0,256),endpoint:String(entry.observed?.endpoint||'').slice(0,256),demo:!!entry.observed?.demo,...(entry.observed?.raw!==undefined?{raw:String(entry.observed.raw).slice(0,256)}:{})};
      if(old){old.observed=observed;old.expression=expression;return old;}
      ensure(this.items.length<5000,'已标记点最多 5000 个。');
      const stem=point.name;let suffix=2;while(this.items.some(item=>item.point.name===point.name))point.name=stem.slice(0,110)+'_'+suffix++;
      const item={key,point,observed,expression};this.items.push(item);return item;
    }
    remove(key){this.items=this.items.filter(item=>item.key!==key);}
    rename(key,name){const item=this.items.find(item=>item.key===key);ensure(item,'标记不存在。');const p=P.normalize({...item.point,name});ensure(!this.items.some(other=>other!==item&&other.point.name===p.name),'点名重复，请使用不同名称。');item.point=p;}
    setExpression(key,expression){const item=this.items.find(p=>p.key===key);ensure(item,'标记不存在。');parseExpression(expression);item.expression=expression.trim();}
    observe(record){if(!record?.verified)return 0;const q=record.request;let updated=0;for(const item of this.items){const p=item.point;if(p.transport!==q.transport||item.observed.endpoint!==q.source.endpoint||p.slave!==q.slave||p.fc!==q.fc)continue;try{const v=view(record,pinRule(p,record));item.observed={...item.observed,value:v.value,raw:v.raw,time:record.receivedAt};updated++;}catch(_){}}return updated;}
    csv(){const csv=P.csv(this.items.map(item=>item.point));if(!this.items.some(i=>i.expression))return csv;const rows=csv.trimEnd().split('\r\n');return rows.map((row,i)=>row+',"'+(i?pythonExpression(this.items[i-1].expression):'expression').replace(/"/g,'""')+'"').join('\r\n')+'\r\n';}
    save(){return this.items.map(({point,observed,expression})=>({point,observed,...(expression?{expression}:{})}));}
  }
  function referenceAddress(fc,address,width=5){
    ensure(Number.isInteger(address)&&address>=0&&address<=65535,'无效协议地址。');
    const prefix={1:'0',2:'1',3:'4',4:'3'}[fc];ensure(prefix!==undefined,'请选择读取数据区。');
    return prefix+String(address+1).padStart(Math.max(width-1,String(address+1).length),'0');
  }
  function displayValue(record,rule,format){
    const value=view(record,rule);
    if(['HEX','BIN'].includes(format)&&!['BOOL','BIT'].includes(rule.type)){
      const bits=P.TYPES[rule.type].words*16;
      ensure(!rule.type.startsWith('FLOAT'),'浮点数请使用数值格式查看。');
      const raw=BigInt.asUintN(bits,BigInt(value.raw));
      return format==='HEX'?raw.toString(16).toUpperCase().padStart(bits/4,'0'):raw.toString(2).padStart(bits,'0').match(/.{1,4}/g).join(' ');
    }
    if(rule.type.startsWith('FLOAT')&&Number.isFinite(Number(value.value)))return String(Number(Number(value.value).toPrecision(8)));
    return formatDisplay(value.value);
  }
  function formatDisplay(value){const text=String(value);if(typeof value!=='bigint'&&/^[+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?$/i.test(text)&&/[.e]/i.test(text)&&Number.isFinite(Number(text)))return String(Number(Number(text).toPrecision(12)));return text;}
  return {request,match,FrameStream,layout,expandBits,resolveLayout,mixedLayout,bitGroupKey,monitorLayout,scaleLabel,formatDisplay,parseExpression,evaluateExpression,pythonExpression,gatewayExpression,PinStore,pinKey,pinRule,view,mark,identity,MarkStore,referenceAddress,displayValue};
});
