# 第三方依赖与来源说明

## 应用源码与图标

应用源码和项目图标采用根目录 [LICENSE](LICENSE) 中的许可。图标的 SVG 和生成逻辑见 `assets/icon.svg`、`scripts/build-icons.py`；没有引入外部字体、图标库或在线脚本。

功能分类和早期交互曾参考 [ModbusKit](https://modbuskit.com/zh/modbus-rtu)。该链接用于说明参考来源，不表示项目与其有关联，也不授予第三方内容的使用许可。本仓库没有附带该网站的抓取页面或下载资源。

## 依赖与运行时

- Electron：MIT，<https://github.com/electron/electron>。许可副本见 [licenses/Electron-LICENSE](licenses/Electron-LICENSE)。
- electron-builder：MIT，<https://github.com/electron-userland/electron-builder>，用于开发和打包。
- Electron 内含 Chromium、Node.js 等组件，各自保留原版权和许可；本应用的 MIT 许可不替代它们的许可。

具体版本由 `package-lock.json` 锁定。分发桌面包时，保留 Electron 构建产物中的 `LICENSE`、`LICENSES.chromium.html` 及其他随运行时提供的许可文件，不要只复制主程序 EXE。

Python 服务使用标准库，源码包不捆绑 Python 解释器。若自行打包解释器、额外驱动或新依赖，应另外核查并保留相应许可。

## 协议与示例

Modbus 名称和协议资料来自相应权利人，本项目不声称获得官方认证或背书。协议资料入口：<https://www.modbus.org/modbus-specifications>。

`examples/` 与 `testdata/` 包含固定测试报文、本机模拟器和协议向量，不包含现场采集记录。文档使用回环地址和保留的文档示例地址。
