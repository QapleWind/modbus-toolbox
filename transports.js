(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./protocol.js') : root.Modbus;
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const lrc = bytes => (-Array.from(bytes).reduce((sum, n) => sum + n, 0)) & 255;
  const ascii = payload => ':' + M.hex([...payload, lrc(payload)]).replace(/ /g, '') + '\r\n';
  function tcp(payload, transaction = 1) {
    check(payload.length >= 2 && payload.length <= 254, 'TCP 的单元 ID 与 PDU 合计应为 2–254 字节。');
    check(Number.isInteger(transaction) && transaction >= 0 && transaction <= 65535, '事务 ID 范围为 0–65535。');
    return Uint8Array.from([...M.word(transaction), 0, 0, ...M.word(payload.length), ...payload]);
  }
  function buildPacket(config, direction, transport = 'rtu') {
    const builder = direction === 'request' ? M.buildRequest : M.buildResponse;
    if (transport === 'rtu') return builder(config);
    const unit = M.integer(config.slave, config.base || 16, transport === 'tcp' ? 0 : direction === 'request' ? 0 : 1, transport === 'tcp' ? 255 : 247, transport === 'tcp' ? '单元 ID' : '设备地址');
    const raw = builder(transport === 'tcp' ? { ...config, slave: '1' } : config).slice(0, -2);
    raw[0] = unit;
    if (transport === 'ascii') return ascii(raw);
    check(transport === 'tcp', '未知协议格式。');
    return tcp(raw, M.integer(config.transaction || '0001', config.base || 16, 0, 65535, '事务 ID'));
  }
  const packetText = packet => typeof packet === 'string' ? packet.trim() : M.hex(packet);
  function parsePacket(input, direction = 'auto', transport = 'rtu') {
    if (transport === 'rtu') return { ...M.parseFrame(input, direction), transport, checkName: 'CRC' };
    let payload, actual, expected, bytes, transaction;
    if (transport === 'ascii') {
      const text = String(input).trim();
      check(text.startsWith(':'), 'ASCII 帧必须以冒号 : 开始。');
      bytes = M.parseHex(text.slice(1));
      check(bytes.length >= 3 && bytes.length <= 255, 'ASCII 帧应包含地址、功能码、数据与 LRC，最多 255 个编码前字节。');
      payload = bytes.slice(0, -1); actual = Array.from(bytes.slice(-1)); expected = [lrc(payload)];
    } else {
      check(transport === 'tcp', '未知协议格式。');
      bytes = typeof input === 'string' ? M.parseHex(input) : Uint8Array.from(input);
      check(bytes.length >= 8 && bytes.length <= 260, '单条 Modbus TCP 报文应为 8–260 字节。');
      check(bytes[2] === 0 && bytes[3] === 0, 'MBAP 协议 ID 应为 00 00。');
      const length = bytes[4] * 256 + bytes[5];
      check(length === bytes.length - 6, `MBAP 长度不匹配：声明 ${length} 字节，实际 ${bytes.length - 6} 字节。`);
      payload = bytes.slice(6); transaction = bytes[0] * 256 + bytes[1];
    }
    const normalized = Uint8Array.from(payload);
    // PDU validation is shared; TCP unit IDs do not have serial broadcast semantics.
    if (transport === 'tcp') normalized[0] = 1;
    const result = M.parseFrame(M.frame(normalized), direction);
    result.slave = payload[0]; result.bytes = bytes; result.transport = transport;
    result.fields[0] = { label: transport === 'tcp' ? '单元 ID' : '设备地址', bytes: payload.slice(0, 1), value: payload[0] };
    result.fields.pop();
    if (transport === 'ascii') {
      result.expected = expected; result.actual = actual; result.checkName = 'LRC'; result.crcValid = M.hex(expected) === M.hex(actual);
      result.fields.push({ label: 'LRC', bytes: Uint8Array.from(actual), value: result.crcValid ? '校验通过' : `校验失败，应为 ${M.hex(expected)}` });
    } else {
      result.transaction = transaction; result.checkName = 'MBAP'; result.crcValid = true; result.warnings = [];
      result.fields.unshift({ label: '事务 ID', bytes: bytes.slice(0, 2), value: transaction }, { label: '协议 ID', bytes: bytes.slice(2, 4), value: 0 }, { label: 'MBAP 长度', bytes: bytes.slice(4, 6), value: bytes.length - 6 });
    }
    return result;
  }
  function bigintInput(value, base) {
    const text = String(value).trim();
    check(text.length > 0 && text.length <= 4096, '请输入整数，最多 4096 个字符。');
    const negative = text.startsWith('-'), unsigned = text.replace(/^[+-]/, '');
    const patterns = { 2: /^(?:0b)?[01]+$/i, 8: /^(?:0o)?[0-7]+$/i, 10: /^\d+$/, 16: /^(?:0x)?[0-9a-f]+$/i };
    check(patterns[base]?.test(unsigned), '输入不符合所选进制，请检查前缀和数字。');
    const clean = unsigned.replace(base === 2 ? /^0b/i : base === 8 ? /^0o/i : base === 16 ? /^0x/i : /$^/, '');
    const n = BigInt((base === 2 ? '0b' : base === 8 ? '0o' : base === 16 ? '0x' : '') + clean);
    return negative ? -n : n;
  }
  function referenceAddress(value, area, format, inputMode) {
    const n = bigintInput(value, inputMode === 'hex' ? 16 : 10), width = Number(format);
    check([5, 6].includes(width) && [0, 1, 3, 4].includes(Number(area)), '请选择数据区和地址格式。');
    const scale = width === 5 ? 10000n : 100000n, base = BigInt(area) * scale;
    let offset = n;
    if (inputMode === 'reference') {
      check(n > base && n < base + scale, '引用地址与所选数据区或位数不匹配。'); offset = n - base - 1n;
    } else if (inputMode === 'one') offset = n - 1n;
    check(offset >= 0n && offset <= 65535n, '请求地址范围为 0–65535。');
    return { offset: offset.toString(), hex: offset.toString(16).toUpperCase().padStart(4, '0'), one: (offset + 1n).toString(), reference: offset + 1n < scale ? (base + offset + 1n).toString().padStart(width, '0') : '超出所选五位引用格式，请选六位格式' };
  }
  function compareFrames(request, response, transport = 'rtu') {
    const req = parsePacket(request, 'request', transport), res = parsePacket(response, 'response', transport), checks = [];
    const add = (name, valid, detail) => checks.push({ name, valid, detail });
    add('请求校验', req.crcValid, req.checkName); add('响应校验', res.crcValid, res.checkName);
    add('设备 / 单元 ID', req.slave === res.slave, `${req.slave} → ${res.slave}`);
    add('功能码', req.fc === (res.fc & 127), `${req.fc} → ${res.fc}`);
    if (transport === 'tcp') add('事务 ID', req.transaction === res.transaction, `${req.transaction} → ${res.transaction}`);
    const raw = transport === 'tcp' ? req.bytes.slice(6) : transport === 'ascii' ? req.bytes.slice(0, -1) : req.bytes.slice(0, -2);
    const rsp = transport === 'tcp' ? res.bytes.slice(6) : transport === 'ascii' ? res.bytes.slice(0, -1) : res.bytes.slice(0, -2);
    if (res.fc & 128) add('正常响应', false, `设备返回异常：${res.exception}`);
    else if ([1, 2, 3, 4].includes(req.fc)) {
      const qty = raw[4] * 256 + raw[5], wanted = req.fc <= 2 ? Math.ceil(qty / 8) : qty * 2;
      add('响应字节数', res.data.length === wanted, `期望 ${wanted}，实际 ${res.data.length}`);
    } else if ([5, 6, 15, 16].includes(req.fc)) add('写入确认字段', M.hex(raw.slice(2, 6)) === M.hex(rsp.slice(2, 6)), `请求 ${M.hex(raw.slice(2, 6))}；响应 ${M.hex(rsp.slice(2, 6))}`);
    else add('自定义字段', false, '请按厂商协议人工核对自定义数据。');
    return { req, res, checks, valid: checks.every(row => row.valid) };
  }
  Object.assign(M, { lrc, ascii, tcp, buildPacket, packetText, parsePacket, bigintInput, referenceAddress, compareFrames });
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
