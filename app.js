'use strict';
(() => {
  const M = window.Modbus;
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let transport = 'rtu';
  const state = {
    request: { base: 16, slave: '01', fc: '3', start: '0000', quantity: '0002', value: '0001', coil: '1', values: '0001, 0002', bitValues: '1, 0, 1, 1', raw: '', custom: false },
    response: { base: 16, slave: '01', fc: '3', start: '0000', quantity: '0002', value: '0001', coil: '1', values: '1, 0, 1, 1', raw: '', custom: false, exception: false, exceptionCode: '2', rows: [{ type: 'UINT16', order: 'ABCD', value: '1' }, { type: 'UINT16', order: 'ABCD', value: '2' }] },
    rules: [], parsed: null, parsedText: ''
  };
  const functionOptions = selected => Object.entries(M.FUNCTIONS).map(([fc, label]) => `<option value="${fc}" ${String(fc) === String(selected) ? 'selected' : ''}>${Number(fc).toString(16).padStart(2, '0').toUpperCase()} · ${label}</option>`).join('');
  const typeOptions = selected => Object.keys(M.TYPES).map(type => `<option ${type === selected ? 'selected' : ''}>${type}</option>`).join('');
  const orderOptions = selected => M.ORDERS.map(order => `<option ${order === selected ? 'selected' : ''}>${order}</option>`).join('');
  function errorAt(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function notify(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { $('toast').hidden = true; }, 2400);
  }
  function valueInput(prefix, key, label, hint = '') {
    return `<label>${label}<input data-config="${prefix}.${key}" value="${esc(state[prefix][key])}" autocomplete="off" spellcheck="false">${hint ? `<small>${hint}</small>` : ''}</label>`;
  }
  function coilInput(prefix) {
    return `<label>线圈状态<select data-config="${prefix}.coil"><option value="1" ${state[prefix].coil === '1' ? 'selected' : ''}>ON · FF 00</option><option value="0" ${state[prefix].coil === '0' ? 'selected' : ''}>OFF · 00 00</option></select></label>`;
  }
  function rawInput(prefix) {
    return `<label class="extra-wide">自定义数据区（HEX，不含地址、功能码和 CRC）<textarea data-config="${prefix}.raw" class="mono" rows="2" spellcheck="false" placeholder="例如 00 00 00 02">${esc(state[prefix].raw)}</textarea><small>按厂商协议填写，CRC 自动追加。自定义功能码按十进制输入。</small></label>`;
  }
  function renderFunction(prefix) {
    const config = state[prefix];
    const control = $(prefix + '-fc').parentElement;
    control.innerHTML = `${config.custom ? `<input id="${prefix}-fc" data-config="${prefix}.fc" type="number" min="1" max="${prefix === 'request' ? 127 : 255}" value="${esc(config.fc)}" aria-label="自定义功能码（十进制）">` : `<select id="${prefix}-fc" data-config="${prefix}.fc">${functionOptions(config.fc)}</select>`}<button id="${prefix}-custom" class="button subtle" type="button" aria-pressed="${config.custom}">${config.custom ? '标准功能码' : '自定义'}</button>`;
  }
  function renderRequestExtra() {
    const c = state.request, fc = Number(c.fc), multiple = !c.custom && [15, 16].includes(fc);
    $('request-start-wrap').hidden = c.custom;
    $('request-quantity-wrap').hidden = c.custom || [5, 6].includes(fc);
    $('request-quantity').readOnly = multiple;
    $('request-quantity-help').textContent = multiple ? '根据输入数值自动计算' : fc <= 2 ? '位数（1–2000）' : '寄存器个数（1–125）';
    let content = '';
    if (c.custom) content = rawInput('request');
    else if (fc === 5) content = `<div class="extra-grid">${coilInput('request')}</div>`;
    else if (fc === 6) content = `<div class="extra-grid">${valueInput('request', 'value', '写入值', c.base === 16 ? '十六进制，0000–FFFF' : '十进制，0–65535')}</div>`;
    else if (multiple) {
      const key = fc === 15 ? 'bitValues' : 'values';
      content = `<label class="extra-wide">${fc === 15 ? '线圈状态（0 / 1，低位在前）' : `寄存器数值（${c.base === 16 ? 'HEX' : 'DEC'}）`}<textarea data-config="request.${key}" class="mono" rows="2" spellcheck="false">${esc(c[key])}</textarea><small>用逗号、空格或换行分隔，每个值对应一个${fc === 15 ? '线圈' : '16 位寄存器'}。</small></label>`;
    }
    $('request-extra').innerHTML = content;
    $('request-quantity').value = c.quantity;
  }
  function renderResponseExtra() {
    const c = state.response, fc = Number(c.fc);
    $('response-mode-wrap').hidden = c.custom;
    let content = '';
    if (c.custom) content = rawInput('response');
    else if (c.exception) {
      content = `<div class="extra-grid"><label>异常码<select data-config="response.exceptionCode">${Object.entries(M.EXCEPTIONS).map(([code, label]) => `<option value="${code}" ${c.exceptionCode === code ? 'selected' : ''}>${Number(code).toString(16).padStart(2, '0').toUpperCase()} · ${label}</option>`).join('')}</select></label></div>`;
    } else if ([3, 4].includes(fc)) {
      content = `<div class="register-toolbar"><p>按寄存器顺序添加，数值使用十进制。</p><button id="add-register" class="button subtle" type="button">＋ 添加寄存器</button></div><div class="register-labels" aria-hidden="true"><span>#</span><span>数据类型</span><span>字节序</span><span>数值（DEC）</span><span></span></div>`;
      content += c.rows.map((row, i) => `<div class="register-row"><span class="row-number">${String(i + 1).padStart(2, '0')}</span><select data-register="${i}.type" aria-label="第 ${i + 1} 行数据类型">${typeOptions(row.type)}</select><select data-register="${i}.order" aria-label="第 ${i + 1} 行字节序">${orderOptions(row.order)}</select><input data-register="${i}.value" class="mono" value="${esc(row.value)}" aria-label="第 ${i + 1} 行数值" spellcheck="false"><button class="icon-button" data-delete-register="${i}" aria-label="删除第 ${i + 1} 行寄存器" type="button">×</button></div>`).join('');
      if (!c.rows.length) content += '<div class="no-registers">点击“添加寄存器”配置响应数据。</div>';
    } else if ([1, 2].includes(fc)) content = `<label class="extra-wide">位数据（0 / 1，低位在前）<textarea class="mono" data-config="response.values" rows="2" spellcheck="false">${esc(c.values)}</textarea><small>用逗号、空格或换行分隔，例如 1, 0, 1, 1 编码为 0D。</small></label>`;
    else content = `<div class="extra-grid">${valueInput('response', 'start', '起始地址')}${fc === 5 ? coilInput('response') : valueInput('response', fc === 6 ? 'value' : 'quantity', fc === 6 ? '写入值' : '写入数量')}</div>`;
    $('response-extra').innerHTML = content;
  }
  function generatorBreakdown(bytes, prefix) {
    let fields;
    try { fields = M.parsePacket(bytes, prefix, transport).fields; }
    catch (_) { fields = [{ label: '设备地址', bytes: bytes.slice(0, 1) }, { label: '功能码', bytes: bytes.slice(1, 2) }, { label: '数据区', bytes: bytes.slice(2, -2) }, { label: 'CRC', bytes: bytes.slice(-2) }]; }
    $(prefix + '-breakdown').innerHTML = fields.map(field => `<div class="byte-field"><small>${esc(field.label.replace('（低字节在前）', ''))}</small><code>${M.hex(field.bytes) || '—'}</code></div>`).join('');
  }
  function generate(prefix) {
    const c = state[prefix];
    try {
      let config = c;
      if (prefix === 'request' && !c.custom && [15, 16].includes(Number(c.fc))) {
        const bits = Number(c.fc) === 15;
        const values = bits ? c.bitValues : c.values;
        const qty = M.listValues(values, bits, c.base).length;
        $('request-quantity').value = qty.toString(c.base).toUpperCase().padStart(c.base === 16 ? 4 : 1, '0');
        config = { ...c, values };
      }
      const bytes = M.buildPacket(config, prefix, transport);
      $(prefix + '-output').value = M.packetText(bytes);
      $(prefix + '-length').textContent = `${bytes.length} ${transport === 'ascii' ? '字符（含 CRLF）' : '字节'}`;
      generatorBreakdown(bytes, prefix); $(prefix + '-breakdown').hidden = false;
      errorAt(prefix + '-error', '');
    } catch (error) {
      $(prefix + '-output').value = ''; $(prefix + '-length').textContent = ''; $(prefix + '-breakdown').hidden = true;
      if (prefix === 'request' && !c.custom && [15, 16].includes(Number(c.fc))) $('request-quantity').value = '';
      errorAt(prefix + '-error', error.message);
    }
    const valid = !!$(prefix + '-output').value;
    document.querySelector(`[data-copy="${prefix}-output"]`).disabled = !valid;
    document.querySelector(`[data-use="${prefix}"]`).disabled = !valid;
    if (prefix === 'request') $('request-points').disabled = !valid || c.custom || ![1, 2, 3, 4].includes(Number(c.fc)) || transport === 'ascii';
  }
  function changeBase(prefix, base) {
    const c = state[prefix], oldBase = c.base;
    for (const [key, width] of [['slave', 2], ['start', 4], ['quantity', 4], ['value', 4], ['transaction', 4]]) {
      try {
        const number = M.integer(c[key], oldBase, 0, 65535, key);
        c[key] = number.toString(base).toUpperCase().padStart(base === 16 ? width : 1, '0');
      } catch (_) { /* Preserve incomplete input so the user can finish it. */ }
    }
    if (prefix === 'request') {
      try { c.values = M.listValues(c.values, false, oldBase).map(number => number.toString(base).toUpperCase().padStart(base === 16 ? 4 : 1, '0')).join(', '); } catch (_) { /* Keep invalid data visible. */ }
    }
    c.base = base;
    for (const key of ['slave', 'start', 'quantity', 'value', 'transaction']) { const input = document.querySelector(`[data-config="${prefix}.${key}"]`); if (input) input.value = c[key]; }
    prefix === 'request' ? renderRequestExtra() : renderResponseExtra(); generate(prefix);
  }
  function formatValue(value, type) {
    if (typeof value === 'bigint') return value.toString();
    if (Object.is(value, -0)) return '-0';
    if (!Number.isFinite(value) || !type.startsWith('FLOAT')) return String(value);
    return Number(value.toPrecision(9)).toString();
  }
  function ruleResult(rule) {
    if (!state.parsed) return { raw: '—', orders: [], error: '' };
    const offset = Number(rule.offset), size = M.TYPES[rule.type][0];
    if (!/^\d+$/.test(String(rule.offset)) || !Number.isSafeInteger(offset)) return { raw: '—', orders: [], error: '请输入非负整数偏移' };
    const bytes = state.parsed.data.slice(offset, offset + size);
    if (bytes.length !== size) return { raw: M.hex(bytes) || '—', orders: [], error: `数据不足，需要 ${size} 字节` };
    return { raw: M.hex(bytes), orders: M.ORDERS.map(order => ({ order, bytes: M.hex(M.reorder(bytes, order)), value: formatValue(M.decode(bytes, rule.type, order), rule.type) })), error: '' };
  }
  function updateRuleResults() {
    state.rules.forEach((rule, i) => {
      const result = ruleResult(rule);
      $(`rule-${i}-raw`).textContent = result.raw;
      $(`rule-${i}-orders`).innerHTML = result.orders.map(row => `<span>${row.order}</span>`).join('');
      $(`rule-${i}-bytes`).innerHTML = result.orders.map(row => `<code>${row.bytes}</code>`).join('');
      $(`rule-${i}-values`).innerHTML = result.error ? `<span class="rule-error">${result.error}</span>` : result.orders.length ? result.orders.map(row => `<span class="value">${row.value}</span>`).join('') : '<span>等待解析报文</span>';
    });
  }
  function renderRules() {
    $('rules-body').innerHTML = state.rules.length ? state.rules.map((rule, i) => `<tr><td><input type="number" min="0" max="254" step="1" value="${esc(rule.offset)}" data-rule="${i}.offset" aria-label="第 ${i + 1} 条规则字节偏移"></td><td><select data-rule="${i}.type" aria-label="第 ${i + 1} 条规则数据类型">${typeOptions(rule.type)}</select></td><td><code id="rule-${i}-raw"></code></td><td id="rule-${i}-orders" class="order-stack"></td><td id="rule-${i}-bytes" class="order-stack"></td><td id="rule-${i}-values" class="order-stack"></td><td><button class="icon-button" data-delete-rule="${i}" type="button" aria-label="删除第 ${i + 1} 条规则">×</button></td></tr>`).join('') : '<tr><td colspan="7" class="rule-empty">暂无规则，点击“添加规则”读取数据区中的数值。</td></tr>';
    updateRuleResults();
  }
  function emptyParser() {
    state.parsed = null; state.parsedText = '';
    $('parse-result').innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">{ }</span><span>粘贴完整报文，查看字段与校验结果</span><small>HEX 支持空格或 0x 前缀；ASCII 帧以冒号开始</small></div>';
    updateRuleResults();
  }
  function parse() {
    try {
      const result = M.parsePacket($('frame-input').value, $('parse-direction').value, transport);
      state.parsed = result; state.parsedText = $('frame-input').value;
      errorAt('parse-error', '');
      $('parse-result').innerHTML = `<div class="parse-summary"><div class="parse-kind">${esc(result.kind)}<small>${result.bytes.length} 字节${transport === 'ascii' ? '（编码前）' : ''} · ${esc(M.FUNCTIONS[result.fc & 127] || '自定义功能码')}</small></div><span class="badge ${result.crcValid ? '' : 'fail'}">${result.crcValid ? '✓ ' + result.checkName + ' 校验通过' : '× ' + result.checkName + ' 校验失败'}</span></div><div class="fields-table">${result.fields.map(field => `<div class="field-line"><span>${esc(field.label)}</span><code>${M.hex(field.bytes) || '—'}</code><span>${esc(field.value)}</span></div>`).join('')}</div><div class="data-strip"><span>数据区 · 偏移从 0 开始</span>${M.hex(result.data) || '（空）'}</div>${result.warnings.map(warning => `<p class="warning">${esc(warning)}</p>`).join('')}`;
      updateRuleResults();
    } catch (error) { errorAt('parse-error', error.message); emptyParser(); }
  }
  function calculateCRC() {
    try {
      const bytes = M.parseHex($('crc-input').value, true), crc = M.hex(transport === 'ascii' ? [M.lrc(bytes)] : M.crcBytes(bytes));
      $('crc-output').value = crc; errorAt('crc-error', '');
      $('crc-detail').innerHTML = bytes.length ? `完整报文 <code>${M.hex(bytes)} <strong>${crc}</strong></code>` : '输入报文数据，实时计算校验码。';
      document.querySelector('[data-copy="crc-output"]').disabled = false;
    } catch (error) {
      $('crc-output').value = ''; $('crc-detail').textContent = ''; errorAt('crc-error', error.message);
      document.querySelector('[data-copy="crc-output"]').disabled = true;
    }
  }
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.dataset.config) {
      const [prefix, key] = el.dataset.config.split('.'); state[prefix][key] = el.value;
      if (key === 'fc' && !state[prefix].custom) prefix === 'request' ? renderRequestExtra() : renderResponseExtra();
      generate(prefix);
    }
    if (el.dataset.register) { const [index, key] = el.dataset.register.split('.'); state.response.rows[index][key] = el.value; generate('response'); }
    if (el.dataset.rule) { const [index, key] = el.dataset.rule.split('.'); state.rules[index][key] = el.value; updateRuleResults(); }
    if (el.id === 'crc-input') calculateCRC();
    if (el.id === 'frame-input' && state.parsed && el.value !== state.parsedText) {
      emptyParser(); errorAt('parse-error', '');
      $('parse-result').innerHTML = '<p class="warning stale">报文已修改，请重新解析。</p>';
    }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.name === 'request-base') changeBase('request', Number(el.value));
    if (el.name === 'response-base') changeBase('response', Number(el.value));
    if (el.id === 'response-mode') { state.response.exception = el.value === 'exception'; renderResponseExtra(); generate('response'); }
    if (el.id === 'parse-direction' && $('frame-input').value.trim()) parse();
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    const id = button.id;
    if (id === 'request-points') { try { window.ModbusLive.openRequest({ ...state.request, transport }); } catch (error) { notify(error.message); } }
    if (['request-custom', 'response-custom'].includes(id)) {
      const prefix = id.split('-')[0], c = state[prefix]; c.custom = !c.custom;
      if (!c.custom && !M.FUNCTIONS[c.fc]) c.fc = '3';
      renderFunction(prefix); prefix === 'request' ? renderRequestExtra() : renderResponseExtra(); generate(prefix);
    }
    if (id === 'add-register') {
      if (state.response.rows.reduce((sum, row) => sum + M.TYPES[row.type][0], 0) >= 250) { notify('响应数据已达到 250 字节上限。'); return; }
      state.response.rows.push({ type: 'UINT16', order: 'ABCD', value: '0' }); renderResponseExtra(); generate('response');
    }
    if (button.dataset.deleteRegister !== undefined) { state.response.rows.splice(Number(button.dataset.deleteRegister), 1); renderResponseExtra(); generate('response'); }
    if (id === 'add-rule') {
      if (state.rules.length >= 125) { notify('最多支持 125 条解析规则。'); return; }
      const previous = state.rules[state.rules.length - 1];
      state.rules.push({ offset: previous ? String((Number(previous.offset) || 0) + M.TYPES[previous.type][0]) : '0', type: 'UINT16' }); renderRules();
    }
    if (button.dataset.deleteRule !== undefined) { state.rules.splice(Number(button.dataset.deleteRule), 1); renderRules(); }
    if (id === 'parse') parse();
    if (id === 'clear') { $('frame-input').value = ''; errorAt('parse-error', ''); emptyParser(); }
    if (button.dataset.use) {
      const prefix = button.dataset.use; $('frame-input').value = $(prefix + '-output').value; $('parse-direction').value = prefix; parse();
      $('parser').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (button.dataset.copy) {
      const input = $(button.dataset.copy), text = input.value + (transport === 'ascii' && ['request-output', 'response-output'].includes(input.id) ? '\r\n' : ''); if (!text) return;
      try { await navigator.clipboard.writeText(text); notify('已复制到剪贴板'); }
      catch (_) {
        const temporary = document.createElement('textarea'); temporary.value = text; temporary.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(temporary); temporary.select();
        const copied = document.execCommand('copy'); temporary.remove();
        if (!copied) { input.focus(); input.select(); }
        notify(copied ? '已复制到剪贴板' : '已选中内容，请按 Ctrl / Command + C 复制');
      }
    }
  });
  $('frame-input').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') parse(); });
  document.querySelectorAll('.tool-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.tool-nav a').forEach(item => item.classList.toggle('active', item === link));
  }));
  for (const prefix of ['request', 'response']) $(prefix + '-fc').innerHTML = functionOptions(state[prefix].fc);
  for (const prefix of ['request', 'response']) {
    state[prefix].transaction = '0001';
    const wrap = document.createElement('div'); wrap.id = prefix + '-transaction-wrap'; wrap.className = 'extra-grid'; wrap.hidden = true;
    wrap.innerHTML = valueInput(prefix, 'transaction', '事务 ID', '与请求 / 响应对应的 MBAP 事务标识符');
    $(prefix + '-extra').before(wrap);
  }
  window.ProtocolApp = { setTransport(next) {
    transport = next;
    for (const prefix of ['request', 'response']) $(prefix + '-slave').parentElement.firstChild.textContent = next === 'tcp' ? '单元 ID' : '设备地址';
    $('request-slave').nextElementSibling.textContent = next === 'tcp' ? '0–255，按 TCP 设备约定' : '1–247，0 为广播';
    for (const prefix of ['request', 'response']) { $(prefix + '-transaction-wrap').hidden = next !== 'tcp'; generate(prefix); }
    $('crc').hidden = next === 'tcp';
    $('crc-title').innerHTML = `<span class="number">04</span> ${next === 'ascii' ? 'LRC 校验计算' : 'CRC-16 校验计算'}`;
    $('crc').querySelector('.section-note').textContent = next === 'ascii' ? '数据字节求和的二进制补码' : 'MODBUS · 0xA001 · 初始值 0xFFFF';
    $('crc-output').parentElement.firstChild.textContent = next === 'ascii' ? 'LRC（1 字节）' : 'CRC（低字节在前）';
    $('crc-input').parentElement.firstChild.textContent = next === 'ascii' ? '报文数据（不含 LRC）' : '报文数据（不含 CRC）';
    document.querySelector('[data-copy="crc-output"]').textContent = next === 'ascii' ? '复制 LRC' : '复制 CRC';
    $('guide').querySelector('.guide-foot').firstChild.textContent = next === 'tcp' ? 'TCP 使用 MBAP 报文头，不附加 CRC / LRC。实际设备连接、读取和标记点表请使用左侧 Modbus 调试工具。' : next === 'ascii' ? 'ASCII 帧以冒号开始，以 CRLF 结束，附加 1 字节 LRC。复制生成的报文时会包含 CRLF。' : '此页用于报文生成与分析，实际设备收发和标记点表请使用左侧 Modbus 调试工具。';
    $('parser').querySelector('.section-note').textContent = next === 'tcp' ? '完整 TCP 帧，包含 MBAP 报文头' : next === 'ascii' ? '以 : 开始的完整 ASCII 帧，包含 LRC' : '完整 RTU 帧，包含 CRC';
    $('frame-input').placeholder = next === 'tcp' ? '00 01 00 00 00 07 01 03 04 00 01 00 02' : next === 'ascii' ? ':01030400010002F5' : '01 03 04 00 01 00 02 2A 32';
    $('frame-input').value = ''; errorAt('parse-error', ''); emptyParser(); calculateCRC();
  } };
  renderRequestExtra(); renderResponseExtra(); generate('request'); generate('response'); renderRules(); calculateCRC();
})();
