'use strict';

const TOOLS = ['rtu', 'tcp', 'debug', 'server', 'rawserial', 'ascii', 'converter', 'text', 'compare', 'bases', 'address', 'bits', 'checker'];
const ASSETS = new Set(['index.html', 'styles.css', 'protocol.js', 'transports.js', 'modbus-points.js', 'debug-model.js', 'device-client.js', 'raw-serial.js', 'app.js', 'suite.js', 'serial.js', 'desktop.js', 'assets/icon.png', 'modbus-server.js', 'modbus-server.css']);

function isAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'toolbox:' && url.hostname === 'app' && !url.username && !url.password && !url.port;
  } catch (_) { return false; }
}

function assetForURL(value) {
  if (!isAppURL(value)) return null;
  try {
    const file = decodeURIComponent(new URL(value).pathname).replace(/^\//, '') || 'index.html';
    return ASSETS.has(file) ? file : null;
  } catch (_) { return null; }
}

function routeForURL(value) {
  if (!isAppURL(value)) return 'debug';
  const tool = new URL(value).hash.slice(2).split('/')[0];
  return tool === 'serial' ? 'debug' : TOOLS.includes(tool) ? tool : 'debug';
}

function safeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const bounds = value.bounds;
  return {
    route: value.route === 'serial' ? 'debug' : TOOLS.includes(value.route) ? value.route : 'debug',
    bounds: bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) && bounds.width >= 700 && bounds.width <= 10000 && bounds.height >= 500 && bounds.height <= 10000
      ? Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(bounds[key])])) : null
  };
}

function selectedPort(ports, id) {
  return typeof id === 'string' && ports.some(port => port.portId === id) ? id : '';
}

module.exports = { TOOLS, ASSETS, isAppURL, assetForURL, routeForURL, safeSettings, selectedPort };
