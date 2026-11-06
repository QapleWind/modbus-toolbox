# Modbus 工具箱桌面版

Electron 程序，默认打开 Modbus 调试。运行不需要 Python、Node.js 或网页服务。

## Windows

面向 Windows 10 / 11 x64。`npm run dist:win` 在 dist 生成安装版 EXE 和免安装 ZIP。

- 安装版：按中文向导完成安装，从桌面快捷方式打开。
- 免安装版：完整解压 ZIP，运行 `Modbus Toolbox.exe`；保留同目录 DLL 和 resources 等文件。

串口自动显示为 COM3、COM4 等，选择后直接连接。USB / RS-485 转串口驱动按设备厂商要求安装；连接参数需与设备一致，被其他软件占用时先释放。

应用标识为 `local.modbus.toolbox`。窗口设置和点位存储保存在当前用户的应用数据目录，移动程序文件不会自动带走这些配置。

## 构建

Node.js 22.12 或以上：

```sh
npm ci
npm test
npm run test:tcp
python3 -m unittest -v test_server.py
npm start
npm run dist:win
```

Mac Apple Silicon：`npm run dist:mac`；`npm run pack` 生成当前平台应用目录。

构建时保留 Electron 随附的许可文件，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。`package.json` 中的 `private: true` 防止意外发布到 npm，不限制 Git 仓库公开。

收发与曲线操作见 [MODBUS-DEBUG.md](MODBUS-DEBUG.md)。标记和连接参数自动保存，收发日志与采集记录需要手动导出。关闭程序释放设备。

桌面进程限制资源来源、串口访问和 TCP 接口，渲染页面无 Node.js 权限。构建未使用商业签名 / Apple 公证。Windows 交叉构建不能代替 Windows 实机启动和真实串口验收。
