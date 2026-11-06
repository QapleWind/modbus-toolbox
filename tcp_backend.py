"""Loopback HTTP service's explicit outbound TCP connection, standard library only."""
import ipaddress
import select
import socket
import threading
import time


class TcpBridge:
    def __init__(self):
        self.socket = None
        self.host = None
        self.port = None
        self.lock = threading.RLock()

    def status(self):
        return {"connected": self.socket is not None, "host": self.host, "port": self.port}

    def close(self):
        with self.lock:
            if self.socket is not None:
                self.socket.close()
            self.socket = None
            self.host = self.port = None
        return self.status()

    def connect(self, settings):
        host = str(settings.get("host", "")).strip()
        ipaddress.IPv4Address(host)
        port = int(settings.get("port", 502))
        if not 1 <= port <= 65535:
            raise ValueError("TCP 端口范围为 1–65535。")
        with self.lock:
            self.close()
            sock = socket.create_connection((host, port), timeout=4)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.setblocking(False)
            self.socket, self.host, self.port = sock, host, port
        return self.status()

    def send(self, hex_data):
        data = bytes.fromhex(str(hex_data))
        if not 1 <= len(data) <= 260:
            raise ValueError("TCP 报文须为 1–260 字节。")
        with self.lock:
            if self.socket is None:
                raise ValueError("TCP 尚未连接。")
            sent, deadline = 0, time.monotonic() + 3
            while sent < len(data):
                if time.monotonic() > deadline:
                    raise TimeoutError("TCP 发送超时。")
                if select.select([], [self.socket], [], 0.1)[1]:
                    n = self.socket.send(data[sent:])
                    if not n:
                        raise ConnectionError("TCP 连接已关闭。")
                    sent += n
            return {"written": sent}

    def read(self):
        with self.lock:
            if self.socket is None:
                return {"hex": "", **self.status()}
            chunks = []
            for _ in range(16):
                try:
                    data = self.socket.recv(4096)
                except BlockingIOError:
                    break
                if not data:
                    self.close()
                    break
                chunks.append(data)
            return {"hex": b"".join(chunks).hex(), **self.status()}
