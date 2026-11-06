"""Small loopback serial bridge for macOS/Linux, using the Python standard library."""
import glob
import os
import select
import threading
import time

try:
    import termios
except ImportError:
    termios = None


class SerialBridge:
    def __init__(self):
        self.fd = None
        self.path = None
        self.original = None
        self.lock = threading.RLock()

    @staticmethod
    def ports():
        patterns = ["/dev/cu.*", "/dev/ttyUSB*", "/dev/ttyACM*", "/dev/ttyS[0-9]*"]
        return sorted(set(path for pattern in patterns for path in glob.glob(pattern)))

    def status(self):
        return {"connected": self.fd is not None, "port": self.path, "supported": termios is not None}

    def close(self):
        with self.lock:
            if self.fd is not None:
                try:
                    if self.original is not None:
                        termios.tcsetattr(self.fd, termios.TCSANOW, self.original)
                except (OSError, termios.error):
                    pass
                finally:
                    os.close(self.fd)
                    self.fd = None
                    self.path = None
                    self.original = None
        return self.status()

    def connect(self, settings):
        if termios is None:
            raise ValueError("此系统请使用 Chrome/Edge 的 Web Serial 连接。")
        path = settings.get("port")
        if path not in self.ports():
            raise ValueError("请选择列表中实际存在的串口。")
        baud = int(settings.get("baud", 9600))
        speed = getattr(termios, "B" + str(baud), None)
        if speed is None:
            raise ValueError("此系统不支持所选波特率。")
        bits = int(settings.get("bits", 8))
        stop = int(settings.get("stop", 1))
        parity = settings.get("parity", "none")
        if bits not in (7, 8) or stop not in (1, 2) or parity not in ("none", "even", "odd"):
            raise ValueError("串口参数无效。")
        with self.lock:
            self.close()
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            try:
                original = termios.tcgetattr(fd)
                attrs = termios.tcgetattr(fd)
                attrs[0] = termios.INPCK if parity != "none" else 0
                attrs[1] = 0
                attrs[2] = termios.CLOCAL | termios.CREAD | (termios.CS8 if bits == 8 else termios.CS7)
                if parity != "none":
                    attrs[2] |= termios.PARENB
                if parity == "odd":
                    attrs[2] |= termios.PARODD
                if stop == 2:
                    attrs[2] |= termios.CSTOPB
                attrs[3] = 0
                attrs[4] = attrs[5] = speed
                attrs[6][termios.VMIN] = 0
                attrs[6][termios.VTIME] = 0
                termios.tcsetattr(fd, termios.TCSANOW, attrs)
                termios.tcflush(fd, termios.TCIOFLUSH)
                self.fd, self.path, self.original = fd, path, original
            except BaseException:
                os.close(fd)
                raise
        return self.status()

    def send(self, data):
        with self.lock:
            if self.fd is None:
                raise ValueError("串口尚未连接。")
            raw = bytes.fromhex(str(data))
            if not raw or len(raw) > 65536:
                raise ValueError("发送数据长度须为 1–65536 字节。")
            total, deadline = 0, time.monotonic() + 3
            while total < len(raw):
                if time.monotonic() > deadline:
                    raise TimeoutError("串口写入超时，部分数据可能已经发送。")
                if select.select([], [self.fd], [], 0.1)[1]:
                    try:
                        total += os.write(self.fd, raw[total:])
                    except BlockingIOError:
                        continue
            return {"written": total}

    def read(self):
        with self.lock:
            if self.fd is None:
                return {"hex": "", **self.status()}
            chunks = []
            for _ in range(16):
                try:
                    raw = os.read(self.fd, 4096)
                except BlockingIOError:
                    break
                if not raw:
                    break
                chunks.append(raw)
            return {"hex": b"".join(chunks).hex(" ").upper(), **self.status()}
