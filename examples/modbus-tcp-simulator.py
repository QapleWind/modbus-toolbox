#!/usr/bin/env python3
"""Local-only Modbus TCP fixture. Never binds a LAN interface."""
import argparse
import socketserver
import struct
import threading
import time

registers = {0: 0x3fc0, 1: 0, 16: 250, 17: 260}
lock = threading.Lock()


def response(payload):
    unit, fc = payload[:2]
    def exception(code):
        return bytes([unit, fc | 128, code])
    if len(payload) < 6:
        return exception(3)
    start, qty = struct.unpack('>HH', payload[2:6])
    if fc in (1, 2, 3, 4):
        if qty < 1 or qty > (2000 if fc <= 2 else 125) or start + qty > 65536:
            return exception(3)
        if fc <= 2:
            data = bytearray((qty + 7) // 8)
            for i in range(qty):
                if (start + i) % 2:
                    data[i // 8] |= 1 << (i % 8)
        else:
            with lock:
                data = b''.join(struct.pack('>H', registers.get(start + i, (start + i + 1) * 10 % 65536)) for i in range(qty))
        return bytes([unit, fc, len(data)]) + data
    if fc == 5:
        return payload[:6] if qty in (0, 0xff00) else exception(3)
    if fc == 6:
        with lock:
            registers[start] = qty
        return payload[:6]
    if fc in (15, 16):
        count = (qty + 7) // 8 if fc == 15 else qty * 2
        if not qty or len(payload) != 7 + count or payload[6] != count:
            return exception(3)
        if fc == 16:
            with lock:
                for i in range(qty):
                    registers[start + i] = int.from_bytes(payload[7 + i * 2:9 + i * 2], 'big')
        return payload[:6]
    return exception(1)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        buffer = b''
        while True:
            chunk = self.request.recv(4096)
            if not chunk:
                return
            buffer += chunk
            while len(buffer) >= 6:
                transaction, protocol, length = struct.unpack('>HHH', buffer[:6])
                if protocol or length < 2 or length > 254:
                    return
                if len(buffer) < length + 6:
                    break
                payload, buffer = buffer[6:6 + length], buffer[6 + length:]
                pdu = response(payload)
                packet = struct.pack('>HHH', transaction, 0, len(pdu)) + pdu
                self.request.sendall(packet[:5])
                time.sleep(0.01)
                self.request.sendall(packet[5:])


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=15020)
    args = parser.parse_args()
    with Server(('127.0.0.1', args.port), Handler) as server:
        print('Local Modbus TCP fixture: 127.0.0.1:%s; register 0 FLOAT32 ABCD=1.5' % server.server_address[1], flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
