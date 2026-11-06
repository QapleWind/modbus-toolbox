#!/usr/bin/env python3
"""Serve this offline tool on loopback; Python standard library only."""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser
from urllib.parse import urlsplit
from serial_backend import SerialBridge
from tcp_backend import TcpBridge
from modbus_server import ModbusServer


class Handler(SimpleHTTPRequestHandler):
    bridge = SerialBridge()
    tcp = TcpBridge()
    modbus_server = ModbusServer()

    def end_headers(self):
        if not urlsplit(self.path).path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        if not self.path.startswith("/api/"):
            super().log_message(format, *args)

    def json_response(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def api_allowed(self):
        host = "127.0.0.1:{}".format(self.server.server_port)
        localhost = "localhost:{}".format(self.server.server_port)
        origin = self.headers.get("Origin")
        return self.headers.get("Host") in (host, localhost) and (origin is None or origin in ("http://" + host, "http://" + localhost))

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        if not self.api_allowed():
            return self.json_response({"error": "仅允许本机同源访问。"}, 403)
        try:
            if path == "/api/serial/ports":
                return self.json_response({"ports": self.bridge.ports(), **self.bridge.status()})
            if path == "/api/serial/status":
                return self.json_response(self.bridge.status())
            if path == "/api/serial/read":
                return self.json_response(self.bridge.read())
            if path == "/api/tcp/status":
                return self.json_response(self.tcp.status())
            if path == "/api/tcp/read":
                return self.json_response(self.tcp.read())
            return self.json_response({"error": "接口不存在。"}, 404)
        except (OSError, ValueError) as error:
            (self.tcp if path.startswith('/api/tcp/') else self.bridge).close()
            return self.json_response({"error": str(error)}, 400)

    def do_POST(self):
        if not self.api_allowed() or self.headers.get_content_type() != "application/json":
            return self.json_response({"error": "仅允许本机同源 JSON 请求。"}, 403)
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 200000:
                raise ValueError("请求长度无效。")
            data = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            if not isinstance(data, dict):
                raise ValueError("Expected an object")
            if path.startswith("/api/server/"):
                return self.json_response(self.modbus_server.action(path[len("/api/server/"):], data))
            if path == "/api/serial/connect":
                return self.json_response(self.bridge.connect(data))
            if path == "/api/serial/disconnect":
                return self.json_response(self.bridge.close())
            if path == "/api/serial/send":
                return self.json_response(self.bridge.send(data.get("hex", "")))
            if path == "/api/tcp/connect":
                return self.json_response(self.tcp.connect(data))
            if path == "/api/tcp/disconnect":
                return self.json_response(self.tcp.close())
            if path == "/api/tcp/send":
                return self.json_response(self.tcp.send(data.get("hex", "")))
            return self.json_response({"error": "接口不存在。"}, 404)
        except (OSError, ValueError, TypeError, AttributeError) as error:
            return self.json_response({"error": str(error)}, 400)


def main():
    parser = argparse.ArgumentParser(description="Modbus 本地工具箱")
    parser.add_argument("--port", type=int, default=8808)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口范围为 1–65535")
    handler = partial(Handler, directory=str(Path(__file__).resolve().parent))
    server = None
    for port in range(args.port, min(args.port + 20, 65536)):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError as error:
            if error.errno not in (48, 98, 10048):
                raise
    if server is None:
        parser.exit(1, "附近端口均被占用，请使用 --port 指定其他端口。\n")
    url = "http://127.0.0.1:{}/".format(server.server_port)
    print("\nModbus 工具箱已启动（13 个工具）\nLocal: {}\n按 Ctrl+C 关闭。\n".format(url), flush=True)
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已关闭。")
    finally:
        Handler.bridge.close()
        Handler.tcp.close()
        Handler.modbus_server.stop()
        server.server_close()


if __name__ == "__main__":
    main()
