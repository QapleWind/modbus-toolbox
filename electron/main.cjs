'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { isAppURL, assetForURL, routeForURL, safeSettings } = require('./desktop-config.cjs');
const {ModbusServer}=require('./modbus-server.cjs');
const modbusServer=new ModbusServer();
const { TcpBridge } = require('./tcp-bridge.cjs');
const { SerialPicker } = require('./serial-picker.cjs');
const serialPicker = new SerialPicker();
const tcp = new TcpBridge();
for (const [event, channel] of [['data', 'desktop:tcp-data'], ['state', 'desktop:tcp-state']]) tcp.on(event, payload => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); });

app.setName('Modbus Toolbox');
app.setAppUserModelId('local.modbus.toolbox');
protocol.registerSchemesAsPrivileged([{ scheme: 'toolbox', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let window = null;
let settings = safeSettings();
let settingsFile;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'";

function trusted(contents, frameURL) {
  return window && !window.isDestroyed() && contents === window.webContents && isAppURL(frameURL || contents.getURL());
}

function persistSettings() {
  if (!settingsFile) return;
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(settings));
    fs.renameSync(settingsFile + '.tmp', settingsFile);
  } catch (error) { console.warn('Could not save window preferences:', error.message); }
}

function configureSession(session) {
  session.setPermissionCheckHandler((contents, permission, origin, details) =>
    trusted(contents) && isAppURL(details?.securityOrigin || origin) && ['serial', 'clipboard-sanitized-write'].includes(permission));
  session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(Boolean(trusted(contents) && isAppURL(details?.requestingUrl || contents.getURL()) && ['serial', 'clipboard-sanitized-write'].includes(permission))));

  session.on('select-serial-port', (event, ports, contents, callback) => {
    event.preventDefault();
    if (!trusted(contents)) { callback(''); return; }
    serialPicker.select(ports, contents, callback);
  });
  session.on('will-download', (event, item, contents) => {
    if (!trusted(contents)) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ title: '导出文件', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())), properties: ['createDirectory', 'showOverwriteConfirmation'] });
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const remembered = settings.bounds;
  const onScreen = remembered && screen.getAllDisplays().some(display => remembered.x + 100 < display.workArea.x + display.workArea.width && remembered.y + 100 < display.workArea.y + display.workArea.height && remembered.x + remembered.width > display.workArea.x + 100 && remembered.y + remembered.height > display.workArea.y + 100);
  const bounds = onScreen ? { ...remembered, width: Math.min(remembered.width, area.width), height: Math.min(remembered.height, area.height) } : { width: Math.min(1600, area.width), height: Math.min(1000, area.height) };
  window = new BrowserWindow({ ...bounds, minWidth: Math.min(1100, area.width), minHeight: Math.min(720, area.height), show: false, title: 'Modbus 工具箱', backgroundColor: '#f5f7fb', autoHideMenuBar: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
  configureSession(window.webContents.session);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://www.modbus.org/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url) || !['/', '/index.html'].includes(new URL(url).pathname)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-navigate-in-page', (_event, url, mainFrame) => { if (mainFrame) { settings.route = routeForURL(url); persistSettings(); } });
  window.once('ready-to-show', () => window.show());
  window.on('close', () => { serialPicker.close(); tcp.close(); modbusServer.stop(); settings.bounds = window.getNormalBounds(); persistSettings(); });
  window.on('closed', () => { window = null; });
  window.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame && code !== -3) dialog.showErrorBox('界面加载失败', description);
  });
  window.loadURL('toolbox://app/index.html#/' + settings.route);
}

function setMenu() {
  const navigate = route => { if (window) window.webContents.send('desktop:navigate', route); };
  const labels = [['debug', 'Modbus 调试'], ['rtu', 'Modbus RTU'], ['tcp', 'Modbus TCP'], ['server', 'Modbus 服务端'], ['rawserial', '串口报文'], ['ascii', 'Modbus ASCII'], ['converter', '数据转换'], ['text', 'HEX 与文本'], ['compare', 'HEX 报文对比'], ['bases', '进制转换'], ['address', '寄存器地址换算'], ['bits', '状态字与位掩码'], ['checker', '请求响应对照']];
  const template = [
    ...(process.platform === 'darwin' ? [{ label: 'Modbus Toolbox', submenu: [{ role: 'about', label: '关于 Modbus 工具箱' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: '退出' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '工具', submenu: labels.map(([route, label], index) => ({ label, accelerator: index < 5 ? `CmdOrCtrl+${index + 1}` : undefined, click: () => navigate(route) })) },
    { label: '显示', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    settingsFile = path.join(app.getPath('userData'), 'window-settings.json');
    try { settings = safeSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (_) { /* First launch uses defaults. */ }
    app.setAboutPanelOptions({ applicationName: 'Modbus 工具箱', applicationVersion: app.getVersion() });
    protocol.handle('toolbox', async request => {
      const file = assetForURL(request.url);
      if (request.method !== 'GET' || !file) return new Response('Not found', { status: 404 });
      try {
        const content = await fs.promises.readFile(path.join(app.getAppPath(), file));
        const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' }[path.extname(file)] || 'application/octet-stream';
        return new Response(content, { headers: { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
      } catch (_) { return new Response('Not found', { status: 404 }); }
    });
    ipcMain.handle('desktop:info', event => trusted(event.sender, event.senderFrame?.url) ? { version: app.getVersion(), platform: process.platform, arch: process.arch } : null);
    for (const [name, action] of [['connect', settings => tcp.connect(settings)], ['send', hex => tcp.send(hex)], ['disconnect', () => tcp.close()]]) ipcMain.handle('desktop:tcp-' + name, (event, data) => {
      if (!trusted(event.sender, event.senderFrame?.url)) throw Error('仅允许本应用页面使用 TCP 连接。');
      return action(data);
    });
    ipcMain.handle('desktop:server-action', (event, action, data) => {
      if (!trusted(event.sender, event.senderFrame?.url)) throw Error('Only this application can control the Modbus server');
      return modbusServer.action(action,data);
    });
    ipcMain.handle('desktop:serial-list', event => {
      if (!trusted(event.sender, event.senderFrame?.url)) throw Error('仅允许本应用读取串口列表。');
      return serialPicker.list(event.sender);
    });
    ipcMain.handle('desktop:serial-select', (event, id) => {
      if (!trusted(event.sender, event.senderFrame?.url)) throw Error('仅允许本应用选择串口。');
      return serialPicker.prepare(id, event.sender);
    });
    setMenu(); createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => serialPicker.close());
  app.on('before-quit', () => tcp.close());
  app.on('before-quit', () => modbusServer.stop());
}
