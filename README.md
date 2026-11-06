# Modbus Toolbox

Modbus RTU / TCP 调试、报文生成与解析、寄存器监视和点位标记工具。提供 Electron 桌面界面，也可通过 Python 服务在本机浏览器中使用。

当前版本：`1.9.2-preview.1`，源码预览。仓库不包含预构建安装包。

## 功能

| 工具 | 用途 |
| --- | --- |
| Modbus 调试 | RTU / TCP 读取、写入、扫描、变化高亮、点位标记与 CSV 导出 |
| 串口报文 | 原始 HEX / 文本收发、CRC / CRLF、文件解析及曲线 |
| Modbus RTU、TCP、ASCII | 常用功能码报文生成与解析，CRC / LRC / MBAP 检查 |
| Modbus 服务端 | TCP 从站模拟，四个数据区，寄存器设置与客户端读写 |
| 数据转换 | 16/32/64 位整数与浮点数、字节序、批量转换 |
| HEX 与文本、报文对比 | 文本编码及逐字节差异 |
| 进制转换、地址换算 | 大整数进制转换、协议地址与手册引用地址 |
| 状态字与位掩码、请求响应对照 | 位提取及请求、响应字段核对 |

模块视图下方的标记点列表和原始报文默认折叠。支持固定混合类型、寄存器位组展开、32/64 位连续地址合并、倍率和受限表达式。

## 启动

### Electron 桌面开发

需要 Node.js 22.12 或以上及 npm：

```sh
npm ci
npm test
npm run test:tcp
npm start
```

桌面程序使用运行电脑上的串口和网络。选择实际设备及参数后点击连接。USB 转串口驱动由设备厂商提供。

### 本机浏览器

需要 Python 3。服务仅使用 Python 标准库，无需 pip 安装：

```sh
python3 start.py --no-browser
```

Windows 可用 `py -3 start.py --no-browser` 或双击 `start.bat`；macOS 可双击 `start.command`。

打开终端打印的地址，默认 `http://127.0.0.1:8808/`，可用 `--port 8809` 改端口。服务仅监听本机回环地址，Ctrl+C 退出。

macOS/Linux 串口由 Python 后端读取；Windows 浏览器串口需使用支持 Web Serial 的 Chrome/Edge 并授权设备。TCP 通过同源 Python 服务连接。此启动方式面向本机使用，不提供远程登录或多用户设备隔离。

## 调试与字节序

配置设备 ID、功能码、零基协议地址和长度 → 连接并读取 → 点选模块设置类型 → 固定或标记 → 导出。

CSV 使用通用字段；BIT 和表达式按需增加列。固定点和标记点分别保存，定义存于当前浏览器或桌面用户目录。日志与历史记录需要手动导出。操作和字段见 [MODBUS-DEBUG.md](MODBUS-DEBUG.md)。

字节序按实际报文字节定义。以 32 位报文 `12 34 56 78` 为例：

| 字节序 | 解析时排列 |
| --- | --- |
| ABCD | `12 34 56 78` |
| BADC | `34 12 78 56` |
| CDAB | `56 78 12 34` |
| DCBA | `78 56 34 12` |

64 位 CDAB 按每 4 字节交换两个 16 位字，不是将四个寄存器整体倒序。

## 构建与检查

```sh
npm run pack       # 当前平台应用目录
npm run dist:win   # Windows x64 安装 EXE 与免安装 ZIP
npm run dist:mac   # macOS Apple Silicon DMG 与 ZIP，需 macOS 环境
python3 -m unittest -v test_server.py test_modbus_server.py
```

构建输出位于 `dist/`，不提交到源码仓库。打包后的桌面程序不需要 Python 或 Node.js，详见 [DESKTOP.md](DESKTOP.md)。测试使用固定报文、本机回环连接或新建伪终端，不主动连接实体设备；这些检查不代替目标电脑与现场设备验收。

## 文档与许可

- [TCP 服务端](MODBUS-SERVER.md)
- [参与开发](CONTRIBUTING.md)
- [问题与漏洞报告](SECURITY.md)
- [第三方依赖与来源说明](THIRD_PARTY_NOTICES.md)

应用源码采用 [MIT License](LICENSE)，依赖和运行时组件保留各自许可。本项目为独立工具；协议资料见 [Modbus 官方规范](https://www.modbus.org/modbus-specifications)。
