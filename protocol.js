(function (root) {
  'use strict';
  const FUNCTIONS = { 1: '读取线圈', 2: '读取离散输入', 3: '读取保持寄存器', 4: '读取输入寄存器', 5: '写单个线圈', 6: '写单个寄存器', 15: '写多个线圈', 16: '写多个寄存器' };
  const EXCEPTIONS = { 1: '非法功能', 2: '非法数据地址', 3: '非法数据值', 4: '设备故障', 5: '确认', 6: '设备忙', 8: '存储奇偶校验错误', 10: '网关路径不可用', 11: '网关目标设备无响应' };
  const TYPES = {
    UINT16: [2, 'Uint16'], INT16: [2, 'Int16'], UINT32: [4, 'Uint32'], INT32: [4, 'Int32'],
    FLOAT32: [4, 'Float32'], UINT64: [8, 'BigUint64'], INT64: [8, 'BigInt64'], FLOAT64: [8, 'Float64']
  };
  const ORDERS = ['ABCD', 'DCBA', 'BADC', 'CDAB'];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const word = n => [n >>> 8 & 255, n & 255];
  const u16 = (bytes, offset) => bytes[offset] * 256 + bytes[offset + 1];
  function parseHex(value, allowEmpty = false) {
    const text = String(value).trim().replace(/\b0x/gi, '');
    assert(allowEmpty || text.length, '请输入十六进制报文。');
    assert(!/[^0-9a-f\s,:;\-]/i.test(text), '报文包含非十六进制字符，请使用 00–FF 字节。');
    const compact = text.replace(/[\s,:;\-]/g, '');
    assert(allowEmpty || compact.length, '请输入十六进制报文。');
    assert(compact.length % 2 === 0, '十六进制字节必须由两位组成，请检查是否缺少一位。');
    assert(compact.length <= 131072, '输入过长，最多支持 65536 字节。');
    return Uint8Array.from(compact.match(/../g) || [], byte => parseInt(byte, 16));
  }
  function integer(value, base, min, max, label) {
    let text = String(value).trim();
    if (base === 16) text = text.replace(/^0x/i, '');
    assert((base === 16 ? /^[\da-f]+$/i : /^\d+$/).test(text), `${label}请输入有效的${base === 16 ? '十六' : '十'}进制整数。`);
    const number = parseInt(text, base);
    assert(Number.isSafeInteger(number) && number >= min && number <= max, `${label}范围为 ${min}–${max}（十进制）。`);
    return number;
  }
  function crc16(bytes) {
    let crc = 0xFFFF;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
    return crc;
  }
  const crcBytes = bytes => { const crc = crc16(bytes); return [crc & 255, crc >>> 8]; };
  function frame(payload) {
    assert(payload.length <= 254, 'RTU 报文（含 CRC）不能超过 256 字节。');
    return Uint8Array.from([...payload, ...crcBytes(payload)]);
  }
  function reorder(bytes, order) {
    assert(ORDERS.includes(order), '不支持的字节序。');
    const result = Array.from(bytes);
    if (order === 'DCBA') result.reverse();
    if (order === 'BADC') for (let i = 0; i + 1 < result.length; i += 2) [result[i], result[i + 1]] = [result[i + 1], result[i]];
    if (order === 'CDAB') for (let i = 0; i + 3 < result.length; i += 4) result.splice(i, 4, result[i + 2], result[i + 3], result[i], result[i + 1]);
    return Uint8Array.from(result);
  }
  function encode(value, type, order = 'ABCD') {
    assert(TYPES[type], '不支持的数据类型。');
    const [size, method] = TYPES[type];
    const buffer = new ArrayBuffer(size), view = new DataView(buffer), text = String(value).trim();
    assert(text.length, '请输入寄存器数值。');
    if (type.startsWith('FLOAT')) {
      assert(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text), `${type} 需要有效的十进制数值。`);
      const value = Number(text);
      assert(Number.isFinite(value), `${type} 数值超出范围。`);
      view[`set${method}`](0, value, false);
      assert(Number.isFinite(view[`get${method}`](0, false)), `${type} 数值超出范围。`);
    } else {
      assert(/^[+-]?\d+$/.test(text), `${type} 需要十进制整数。`);
      const value = BigInt(text), bits = BigInt(size * 8), signed = type.startsWith('INT');
      const min = signed ? -(1n << (bits - 1n)) : 0n, max = (1n << (signed ? bits - 1n : bits)) - 1n;
      assert(value >= min && value <= max, `${type} 数值范围为 ${min}–${max}。`);
      view[`set${method}`](0, size === 8 ? value : Number(value), false);
    }
    return reorder(new Uint8Array(buffer), order);
  }
  function decode(bytes, type, order = 'ABCD') {
    assert(TYPES[type], '不支持的数据类型。');
    const [size, method] = TYPES[type];
    assert(bytes.length === size, `数据不足，${type} 需要 ${size} 字节。`);
    const data = reorder(bytes, order);
    return new DataView(data.buffer)[`get${method}`](0, false);
  }
  function listValues(text, bits, base) {
    const tokens = String(text).trim().split(/[\s,;，]+/).filter(Boolean);
    assert(tokens.length, bits ? '请输入线圈状态，例如 1, 0, 1, 1。' : '请输入寄存器数值，例如 0001, 0002。');
    assert(tokens.length <= (bits ? 2000 : 125), '输入数值过多。');
    return tokens.map(token => integer(token, bits ? 10 : base, 0, bits ? 1 : 65535, bits ? '线圈状态' : '寄存器数值'));
  }
  function packBits(bits) {
    const bytes = Array(Math.ceil(bits.length / 8)).fill(0);
    bits.forEach((value, index) => { bytes[index >>> 3] |= value << (index % 8); });
    return bytes;
  }
  function range(start, quantity, max) {
    assert(quantity >= 1 && quantity <= max, `数量范围为 1–${max}（十进制）。`);
    assert(start + quantity <= 65536, '起始地址加数量超出 16 位地址范围。');
  }
  function buildRequest(config) {
    const base = config.base || 16, slave = integer(config.slave, base, 0, 247, '设备地址');
    const fc = integer(config.fc, 10, 1, 127, '功能码');
    if (config.custom) return frame([slave, fc, ...parseHex(config.raw, true)]);
    assert(FUNCTIONS[fc], '请选择支持的功能码。');
    assert(slave !== 0 || ![1, 2, 3, 4].includes(fc), '广播地址 0 不支持读取，请使用设备地址 1–247。');
    const start = integer(config.start, base, 0, 65535, '起始地址');
    let payload = [slave, fc, ...word(start)];
    if ([1, 2, 3, 4].includes(fc)) {
      const qty = integer(config.quantity, base, 1, fc <= 2 ? 2000 : 125, '数量');
      range(start, qty, fc <= 2 ? 2000 : 125);
      payload.push(...word(qty));
    } else if (fc === 5) {
      assert(config.coil === '0' || config.coil === '1', '请选择线圈状态。');
      payload.push(...word(config.coil === '1' ? 0xFF00 : 0));
    } else if (fc === 6) payload.push(...word(integer(config.value, base, 0, 65535, '写入值')));
    else {
      const values = listValues(config.values, fc === 15, base);
      range(start, values.length, fc === 15 ? 1968 : 123);
      const data = fc === 15 ? packBits(values) : values.flatMap(word);
      payload.push(...word(values.length), data.length, ...data);
    }
    return frame(payload);
  }
  function buildResponse(config) {
    const base = config.base || 16, slave = integer(config.slave, base, 1, 247, '设备地址');
    const fc = integer(config.fc, 10, 1, config.custom ? 255 : 127, '功能码');
    if (config.custom) return frame([slave, fc, ...parseHex(config.raw, true)]);
    if (config.exception) return frame([slave, fc | 0x80, integer(config.exceptionCode, 10, 1, 255, '异常码')]);
    assert(FUNCTIONS[fc], '请选择支持的功能码。');
    if ([1, 2].includes(fc)) {
      const bits = listValues(config.values, true, 10), data = packBits(bits);
      return frame([slave, fc, data.length, ...data]);
    }
    if ([3, 4].includes(fc)) {
      assert(config.rows && config.rows.length, '请至少添加一个寄存器数值。');
      const data = config.rows.flatMap((row, index) => {
        try { return Array.from(encode(row.value, row.type, row.order)); }
        catch (error) { throw new Error(`第 ${index + 1} 行：${error.message}`); }
      });
      assert(data.length <= 250, '响应数据最多 250 字节（125 个寄存器）。');
      return frame([slave, fc, data.length, ...data]);
    }
    const start = integer(config.start, base, 0, 65535, '起始地址');
    let value;
    if (fc === 5) {
      assert(config.coil === '0' || config.coil === '1', '请选择线圈状态。');
      value = config.coil === '1' ? 0xFF00 : 0;
    } else if (fc === 6) value = integer(config.value, base, 0, 65535, '写入值');
    else {
      value = integer(config.quantity, base, 1, fc === 15 ? 1968 : 123, '数量');
      range(start, value, fc === 15 ? 1968 : 123);
    }
    return frame([slave, fc, ...word(start), ...word(value)]);
  }
  function parseFrame(input, direction = 'auto') {
    const bytes = typeof input === 'string' ? parseHex(input) : Uint8Array.from(input);
    assert(['auto', 'request', 'response'].includes(direction), '请选择有效的解析方向。');
    assert(bytes.length >= 4 && bytes.length <= 256, 'RTU 报文长度应为 4–256 字节（包含 CRC）。');
    const slave = bytes[0], fc = bytes[1], end = bytes.length - 2;
    assert(slave <= 247, '设备地址 248–255 为保留地址。');
    assert(fc !== 0 && fc !== 128, '功能码 0 无效。');
    const expected = crcBytes(bytes.slice(0, end)), actual = Array.from(bytes.slice(end));
    const result = { bytes, slave, fc, expected, actual, crcValid: hex(expected) === hex(actual), data: bytes.slice(2, end), kind: '自定义报文', fields: [], warnings: [] };
    const field = (label, start, length, value) => result.fields.push({ label, bytes: bytes.slice(start, start + length), value });
    field('设备地址', 0, 1, slave); field('功能码', 1, 1, FUNCTIONS[fc & 127] || '自定义');
    if (slave === 0) result.warnings.push('地址 0 为广播地址，设备不会返回响应。');
    if (fc & 128) {
      assert(direction !== 'request', '异常帧属于响应，请选择响应或自动识别。');
      assert(slave !== 0, '广播地址不能用于响应。');
      assert(bytes.length === 5, '异常响应长度应为 5 字节。');
      result.kind = '异常响应'; result.exception = EXCEPTIONS[bytes[2]] || '厂商自定义异常';
      field('异常码', 2, 1, result.exception);
    } else if ([1, 2, 3, 4].includes(fc)) {
      const isResponse = bytes[2] >= 1 && bytes[2] <= 250 && bytes.length === bytes[2] + 5 && (fc <= 2 || bytes[2] % 2 === 0);
      const isRequest = bytes.length === 8 && u16(bytes, 4) >= 1 && u16(bytes, 4) <= (fc <= 2 ? 2000 : 125) && u16(bytes, 2) + u16(bytes, 4) <= 65536;
      assert(!(direction === 'auto' && isRequest && isResponse), '报文同时符合请求与响应结构，请手动选择解析方向。');
      const response = direction === 'response' || (direction === 'auto' && isResponse);
      assert(response ? isResponse : isRequest, response ? '响应长度或字节数不正确；寄存器数据必须为偶数字节。' : '读取请求应为 8 字节，请检查数量与地址范围，或切换解析方向。');
      assert(slave !== 0, response ? '广播地址不能用于响应。' : '广播地址不支持读取请求。');
      if (response) {
        result.kind = '读取响应'; result.data = bytes.slice(3, end);
        field('数据字节数', 2, 1, bytes[2]); field('数据区', 3, end - 3, fc <= 2 ? '线圈 / 离散输入，低位在前' : `${bytes[2] / 2} 个寄存器`);
      } else {
        result.kind = '读取请求'; result.data = bytes.slice(2, end);
        field('起始地址', 2, 2, u16(bytes, 2)); field('数量', 4, 2, u16(bytes, 4));
      }
    } else if ([5, 6].includes(fc)) {
      assert(bytes.length === 8, '单点写入请求 / 确认应为 8 字节。');
      assert(fc !== 5 || [0, 0xFF00].includes(u16(bytes, 4)), '写单线圈的值必须为 FF 00 或 00 00。');
      assert(direction !== 'response' || slave !== 0, '广播地址不能用于响应。');
      result.kind = direction === 'request' ? '写入请求' : direction === 'response' ? '写入确认' : '写入请求 / 确认（同帧）';
      result.data = bytes.slice(4, end); field('写入地址', 2, 2, u16(bytes, 2)); field('写入值', 4, 2, fc === 5 ? (bytes[4] ? 'ON' : 'OFF') : u16(bytes, 4));
    } else if ([15, 16].includes(fc)) {
      const response = direction === 'response' || (direction === 'auto' && bytes.length === 8);
      assert(bytes.length >= (response ? 8 : 10), '多点写入报文长度不足。');
      const qty = u16(bytes, 4); range(u16(bytes, 2), qty, fc === 15 ? 1968 : 123);
      field('起始地址', 2, 2, u16(bytes, 2)); field('数量', 4, 2, qty);
      if (response) {
        assert(slave !== 0, '广播地址不能用于响应。'); assert(bytes.length === 8, '多点写入确认应为 8 字节。');
        result.kind = '写入确认';
      } else {
        const count = fc === 15 ? Math.ceil(qty / 8) : qty * 2;
        assert(bytes[6] === count && bytes.length === count + 9, '字节数、写入数量与实际数据长度不匹配。');
        result.kind = '写入请求'; result.data = bytes.slice(7, end); field('数据字节数', 6, 1, count); field('数据区', 7, count, '写入数据');
      }
    } else field('数据区', 2, end - 2, '厂商自定义格式');
    field('CRC（低字节在前）', end, 2, result.crcValid ? '校验通过' : `校验失败，应为 ${hex(expected)}`);
    if (slave === 0 && result.kind.includes('确认')) result.kind = '广播写入请求';
    return result;
  }
  const api = { FUNCTIONS, EXCEPTIONS, TYPES, ORDERS, hex, word, parseHex, integer, crc16, crcBytes, frame, reorder, encode, decode, listValues, packBits, buildRequest, buildResponse, parseFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Modbus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
