import http.client
import json
import os
import select
import socket
import time
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from start import Handler
from serial_backend import SerialBridge, termios


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(Path(__file__).parent)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_static_and_status(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"suite.js", body)
        status, body = self.request("GET", "/api/serial/status")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["connected"])

    def test_modbus_server_control_api_and_origin_boundary(self):
        headers = {'Content-Type': 'application/json'}
        self.assertEqual(self.request('POST', '/api/server/stop', '{}', headers)[0], 200)
        status, body = self.request('POST', '/api/server/status', '{}', headers)
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)['running'])
        self.assertEqual(self.request('POST', '/api/server/set', '{"area":"holding","address":0,"values":[789]}', headers)[0],200)
        status, body = self.request('POST', '/api/server/status', '{}', headers)
        self.assertEqual(json.loads(body)['values'][0],789)
        self.assertEqual(self.request('POST', '/api/server/set', '{}', headers)[0],400)
        self.assertEqual(self.request('POST', '/api/server/start', '{}', {**headers,'Origin':'https://evil.example'})[0],403)

    def test_static_script_version_cannot_reuse_a_previous_build(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET', '/serial.js?v=1.5.0')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            self.assertIn(b'window.ModbusPoints', response.read())
        finally:
            connection.close()

    def test_cross_origin_and_wrong_content_type_rejected(self):
        status, _ = self.request("POST", "/api/serial/disconnect", "{}", {"Origin": "https://example.com", "Content-Type": "application/json"})
        self.assertEqual(status, 403)
        status, _ = self.request("POST", "/api/serial/disconnect", "{}", {"Content-Type": "text/plain"})
        self.assertEqual(status, 403)
        status, _ = self.request("GET", "/api/serial/status", headers={"Host": "attacker.example"})
        self.assertEqual(status, 403)

    def test_disconnected_send_and_arbitrary_path_rejected(self):
        status, _ = self.request("POST", "/api/serial/send", '{"hex":"01 03"}', {"Content-Type": "application/json"})
        self.assertEqual(status, 400)

    def test_tcp_connect_send_fragmented_read_and_disconnect(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        packet = bytes.fromhex('000100000007010304000a0014')
        captured = []
        def peer():
            conn, _ = listener.accept()
            with conn:
                captured.append(conn.recv(260))
                conn.sendall(packet[:5])
                time.sleep(0.02)
                conn.sendall(packet[5:])
        worker = threading.Thread(target=peer, daemon=True)
        worker.start()
        headers = {'Content-Type': 'application/json'}
        try:
            status, body = self.request('POST', '/api/tcp/connect', json.dumps({'host':'127.0.0.1','port':listener.getsockname()[1]}), headers)
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(body)['connected'])
            status, _ = self.request('POST', '/api/tcp/send', '{"hex":"00 01 00 00 00 06 01 03 00 00 00 02"}', headers)
            self.assertEqual(status, 200)
            received = b''
            deadline = time.monotonic() + 2
            while len(received) < len(packet) and time.monotonic() < deadline:
                status, body = self.request('GET', '/api/tcp/read')
                self.assertEqual(status, 200)
                received += bytes.fromhex(json.loads(body)['hex'])
                time.sleep(0.01)
            self.assertEqual(received, packet)
            self.assertEqual(captured[0].hex(), '000100000006010300000002')
            status, body = self.request('POST', '/api/tcp/disconnect', '{}', headers)
            self.assertEqual(status, 200)
            self.assertFalse(json.loads(body)['connected'])
        finally:
            self.server.RequestHandlerClass.func.tcp.close()
            listener.close()
            worker.join(1)

    def test_tcp_invalid_targets_and_cross_origin_requests_rejected(self):
        headers = {'Content-Type': 'application/json'}
        status, _ = self.request('POST', '/api/tcp/connect', '{"host":"not-an-ip","port":502}', headers)
        self.assertEqual(status, 400)
        status, _ = self.request('POST', '/api/tcp/connect', '{"host":"127.0.0.1","port":0}', headers)
        self.assertEqual(status, 400)
        status, _ = self.request('POST', '/api/tcp/connect', '{"host":"127.0.0.1","port":502}', {**headers,'Origin':'https://example.com'})
        self.assertEqual(status, 403)
        status, _ = self.request("POST", "/api/serial/connect", '{"port":"/etc/passwd"}', {"Content-Type": "application/json"})
        self.assertEqual(status, 400)


@unittest.skipIf(termios is None, "PTY test requires Unix")
class BridgeTests(unittest.TestCase):
    def test_send_and_receive_on_virtual_terminal(self):
        import pty
        master, slave = pty.openpty()
        bridge = SerialBridge()
        try:
            path = os.ttyname(slave)
            with patch.object(bridge, "ports", return_value=[path]):
                bridge.connect({"port": path, "baud": 9600, "bits": 8, "parity": "none", "stop": 1})
            self.assertEqual(bridge.send("01 03 00 00 00 02 C4 0B")["written"], 8)
            self.assertTrue(select.select([master], [], [], 1)[0])
            self.assertEqual(os.read(master, 64).hex(), "010300000002c40b")
            os.write(master, bytes.fromhex("01 03 04 00 01 00 02 2A 32"))
            self.assertTrue(select.select([bridge.fd], [], [], 1)[0])
            self.assertEqual(bridge.read()["hex"], "01 03 04 00 01 00 02 2A 32")
            self.assertFalse(bridge.close()["connected"])
        finally:
            bridge.close()
            os.close(master)
            os.close(slave)


if __name__ == "__main__":
    unittest.main(verbosity=2)
