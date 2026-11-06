const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAppURL, assetForURL, routeForURL, safeSettings, selectedPort } = require('./desktop-config.cjs');

test('every HTML entry asset is available through the secure desktop protocol and build',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),files=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).build.files;
  const assets=Array.from(html.matchAll(/(?:src|href)="([a-z][a-z0-9/-]*\.(?:js|css)(?:\?[^" ]*)?)"/g),m=>m[1]);
  assert(assets.length>=10);
  for(const reference of assets){
    const url=new URL('toolbox://app/'+reference),asset=url.pathname.slice(1);
    assert(url.searchParams.has('v'),asset+' missing cache version');
    assert.equal(assetForURL(url.href),asset);assert(files.includes(asset),asset+' missing from build');assert(fs.existsSync(path.join(root,asset)));
  }
});

test('runtime Windows identity matches the packaged application identity',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
  assert(main.includes("app.setAppUserModelId('"+pkg.build.appId+"')"));
  assert(main.includes("app.setName('"+pkg.build.productName+"')"));
});

test('only the bundled app origin is accepted', () => {
  assert.equal(isAppURL('toolbox://app/index.html#/serial'), true);
  for (const url of ['https://app/index.html', 'toolbox://app.evil/index.html', 'toolbox://user@app/index.html', 'toolbox://app:8080/', 'file:///etc/passwd', 'not a url']) assert.equal(isAppURL(url), false);
});
test('asset resolver denies arbitrary files and encoded traversal', () => {
  assert.equal(assetForURL('toolbox://app/'), 'index.html');
  assert.equal(assetForURL('toolbox://app/serial.js'), 'serial.js');
  assert.equal(assetForURL('toolbox://app/modbus-points.js'), 'modbus-points.js');
  assert.equal(assetForURL('toolbox://app/point-table.js'), null);
  assert.equal(assetForURL('toolbox://app/debug-model.js'), 'debug-model.js');
  assert.equal(assetForURL('toolbox://app/raw-serial.js'), 'raw-serial.js');
  for (const url of ['toolbox://app/electron/main.cjs', 'toolbox://app/package.json', 'toolbox://app/%2e%2e/%2e%2e/etc/passwd', 'toolbox://app/%2Fetc%2Fpasswd', 'toolbox://app/%00index.html', 'toolbox://other/index.html', 'toolbox://app/%FF']) assert.equal(assetForURL(url), null);
});
test('saved routes and window bounds recover safely', () => {
  assert.equal(routeForURL('toolbox://app/index.html#/tcp/parser'), 'tcp');
  assert.equal(routeForURL('toolbox://app/index.html#/points'), 'debug');
  assert.equal(routeForURL('toolbox://app/index.html#/unknown'), 'debug');
  assert.equal(routeForURL('toolbox://app/index.html#/serial'), 'debug');
  assert.equal(routeForURL('toolbox://app/index.html#/rawserial'), 'rawserial');
  assert.deepEqual(safeSettings({ route: 'serial', bounds: { x: 20, y: 30, width: 1600, height: 1000 } }), { route: 'debug', bounds: { x: 20, y: 30, width: 1600, height: 1000 } });
  assert.equal(safeSettings({ bounds: { x: 0, y: 0, width: Infinity, height: 1000 } }).bounds, null);
  assert.equal(safeSettings(null).route, 'debug');
  assert.equal(safeSettings({ route: '../../private' }).route, 'debug');
});
test('a serial port must be explicitly selected from the current list', () => {
  const ports = [{ portId: 'a' }, { portId: 'b' }];
  assert.equal(selectedPort(ports, 'b'), 'b');
  assert.equal(selectedPort(ports, 'missing'), '');
  assert.equal(selectedPort(ports, undefined), '');
  assert.equal(selectedPort([], 'a'), '');
});
