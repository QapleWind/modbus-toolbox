const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./protocol.js');
const request = overrides => ({ base: 16, slave: '01', fc: '3', start: '0000', quantity: '0002', value: '0001', coil: '1', values: '0001, 0002', ...overrides });
const response = overrides => ({ base: 16, slave: '01', fc: '3', start: '0000', quantity: '0002', value: '0001', coil: '1', values: '1, 0, 1, 1', rows: [{ type: 'UINT16', order: 'ABCD', value: '1' }, { type: 'UINT16', order: 'ABCD', value: '2' }], ...overrides });

test('CRC known vectors and little-endian wire order', () => {
  assert.equal(M.crc16(M.parseHex('313233343536373839')), 0x4B37);
  assert.equal(M.hex(M.crcBytes(M.parseHex('01 03 00 00 00 02'))), 'C4 0B');
  assert.equal(M.hex(M.crcBytes(M.parseHex('01 06 00 00 00 01'))), '48 0A');
  assert.equal(M.crc16([]), 0xFFFF);
});
test('read request and register response match fixed frames', () => {
  assert.equal(M.hex(M.buildRequest(request())), '01 03 00 00 00 02 C4 0B');
  assert.equal(M.hex(M.buildResponse(response())), '01 03 04 00 01 00 02 2A 32');
  assert.equal(M.hex(M.buildRequest(request({ fc: '6' }))), '01 06 00 00 00 01 48 0A');
});
test('eight supported functions produce parsable requests and responses', () => {
  for (const fc of Object.keys(M.FUNCTIONS)) {
    const req = M.buildRequest(request({ fc, values: fc === '15' ? '1, 0, 1, 1' : '0001, 0002' }));
    const res = M.buildResponse(response({ fc }));
    assert.equal(M.parseFrame(req, 'request').crcValid, true, `request ${fc}`);
    assert.equal(M.parseFrame(res, 'response').crcValid, true, `response ${fc}`);
  }
});
test('single-coil writes use FF00 / 0000 and bit arrays pack LSB first', () => {
  assert.deepEqual(Array.from(M.buildRequest(request({ fc: '5', coil: '1' })).slice(4, 6)), [255, 0]);
  assert.deepEqual(Array.from(M.buildRequest(request({ fc: '5', coil: '0' })).slice(4, 6)), [0, 0]);
  assert.deepEqual(M.packBits([1, 0, 1, 1, 0, 0, 0, 0, 1]), [13, 1]);
  assert.deepEqual(Array.from(M.buildRequest(request({ fc: '15', values: '1,0,1,1' })).slice(4, -2)), [0, 4, 1, 13]);
  assert.deepEqual(Array.from(M.buildRequest(request({ fc: '16' })).slice(4, -2)), [0, 2, 4, 0, 1, 0, 2]);
});
test('HEX and DEC configurations represent the same request', () => {
  assert.deepEqual(M.buildRequest(request({ start: '0010', quantity: '000A' })), M.buildRequest(request({ base: 10, slave: '1', start: '16', quantity: '10' })));
});
test('request quantity, address overflow and broadcast limits are enforced', () => {
  for (const config of [{ quantity: '0000' }, { quantity: '007E' }, { start: 'FFFF', quantity: '0002' }, { slave: 'F8' }, { slave: '00' }, { fc: '16', values: Array(124).fill('0000').join(',') }, { fc: '15', values: Array(1969).fill('0').join(',') }]) assert.throws(() => M.buildRequest(request(config)));
  assert.equal(M.parseFrame(M.buildRequest(request({ slave: '00', fc: '6' })), 'request').slave, 0);
  assert.throws(() => M.buildResponse(response({ slave: '00' })));
});
test('typed register encoding has known byte layouts', () => {
  assert.equal(M.hex(M.encode('3.14', 'FLOAT32')), '40 48 F5 C3');
  assert.equal(M.hex(M.encode('-2', 'INT16')), 'FF FE');
  assert.equal(M.hex(M.encode('305419896', 'UINT32', 'BADC')), '34 12 78 56');
  assert.equal(M.hex(M.encode('305419896', 'UINT32', 'CDAB')), '56 78 12 34');
  assert.equal(M.hex(M.encode('1', 'FLOAT64')), '3F F0 00 00 00 00 00 00');
});
test('all data types and byte orders round-trip including exact 64-bit extremes', () => {
  const values = { UINT16: '65535', INT16: '-32768', UINT32: '4294967295', INT32: '-2147483648', FLOAT32: '3.5', UINT64: '18446744073709551615', INT64: '-9223372036854775808', FLOAT64: '-1.25e200' };
  for (const [type, value] of Object.entries(values)) for (const order of M.ORDERS) {
    const result = M.decode(M.encode(value, type, order), type, order);
    assert.equal(result, type.includes('64') && !type.startsWith('FLOAT') ? BigInt(value) : Number(value));
  }
});
test('numeric ranges, fractional integers and non-finite values cannot silently wrap', () => {
  for (const [value, type] of [['65536', 'UINT16'], ['-1', 'UINT32'], ['32768', 'INT16'], ['18446744073709551616', 'UINT64'], ['-9223372036854775809', 'INT64'], ['3.1', 'INT32'], ['1e100', 'FLOAT32'], ['NaN', 'FLOAT64'], ['', 'UINT16']]) assert.throws(() => M.encode(value, type));
  assert.throws(() => M.decode([0], 'UINT16'));
});
test('64-bit CDAB swaps words within each group of four bytes', () => {
  assert.deepEqual(Array.from(M.reorder([1, 2, 3, 4, 5, 6, 7, 8], 'CDAB')), [3, 4, 1, 2, 7, 8, 5, 6]);
});
test('parser separates the response data and identifies a corrupted CRC', () => {
  const result = M.parseFrame('01 03 04 00 01 00 02 2A 32');
  assert.equal(result.kind, '读取响应'); assert.equal(result.crcValid, true);
  assert.equal(M.hex(result.data), '00 01 00 02');
  const bad = M.parseFrame('01 03 04 00 01 00 02 00 00');
  assert.equal(bad.crcValid, false); assert.equal(M.hex(bad.expected), '2A 32');
});
test('float example parses at the expected offsets', () => {
  const parsed = M.parseFrame('01 03 0C 40 48 F5 C3 00 00 01 3A C6 FE FF FF 39 D4');
  assert.equal(parsed.crcValid, true);
  assert.ok(Math.abs(M.decode(parsed.data.slice(0, 4), 'FLOAT32') - 3.14) < 0.000001);
  assert.equal(M.decode(parsed.data.slice(4, 8), 'UINT32'), 314);
  assert.equal(M.decode(parsed.data.slice(8, 12), 'INT32'), -956366849);
});
test('exception responses decode and reject impossible request directions', () => {
  const bytes = M.buildResponse(response({ exception: true, exceptionCode: '2' }));
  assert.equal(M.hex(bytes), '01 83 02 C0 F1');
  const parsed = M.parseFrame(bytes);
  assert.equal(parsed.exception, '非法数据地址'); assert.equal(parsed.crcValid, true);
  assert.throws(() => M.parseFrame(bytes, 'request'));
});
test('parser validates declared byte counts, even register data and single-coil values', () => {
  for (const payload of [[1, 3, 3, 0, 1, 0], [1, 3, 4, 0, 1], [1, 16, 0, 0, 0, 2, 2, 0, 1], [1, 5, 0, 0, 0, 1]]) assert.throws(() => M.parseFrame(M.frame(payload)));
  assert.throws(() => M.parseFrame('01 03'));
  assert.throws(() => M.parseFrame(M.frame([248, 6, 0, 0, 0, 1])));
});
test('ambiguous coil frames require an explicit direction', () => {
  const bytes = M.frame([1, 1, 3, 0, 0, 1]);
  assert.throws(() => M.parseFrame(bytes), /方向/);
  assert.equal(M.parseFrame(bytes, 'request').kind, '读取请求');
  assert.equal(M.parseFrame(bytes, 'response').kind, '读取响应');
});
test('raw custom frames append CRC and enforce RTU maximum size', () => {
  const bytes = M.buildRequest(request({ custom: true, fc: '65', raw: 'AA BB' }));
  assert.equal(M.hex(bytes.slice(0, -2)), '01 41 AA BB');
  assert.equal(M.parseFrame(bytes).crcValid, true);
  assert.throws(() => M.frame(Array(255).fill(0)));
});
test('HEX input accepts common formats and rejects invalid or truncated bytes', () => {
  for (const text of ['010300000002', '01 03\n00 00 00 02', '0x01,0x03,0x00,0x00,0x00,0x02', '01:03:00:00:00:02']) assert.equal(M.hex(M.parseHex(text)), '01 03 00 00 00 02');
  for (const text of ['01 GG 02', '010', '', 'hello', '1.03']) assert.throws(() => M.parseHex(text));
});
