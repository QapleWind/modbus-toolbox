import json
from pathlib import Path
import socket
import struct
import time
import unittest
from modbus_server import ModbusServer

def packet(pdu, unit=1, transaction=0xabcd):
    body = bytes.fromhex(pdu)
    return struct.pack('>HHHB', transaction, 0, len(body)+1, unit) + body

class ModbusServerTests(unittest.TestCase):
    def test_shared_protocol_vectors(self):
        vectors = json.loads((Path(__file__).parent/'testdata/server-vectors.json').read_text())
        for v in vectors:
            with self.subTest(v['name']):
                server = ModbusServer()
                server.config.update(start=10, count=16)
                server.banks = {k: [0]*16 for k in server.banks}
                for area, values in dict(coils=[1,0,1,0,0,0,0,1,1], discrete=[0,1,1], holding=[0x1234,0xabcd], input=[0x5678,65535]).items():
                    server.set(dict(area=area, address=10, values=values))
                reply = server.handle(packet(v['pdu'], v.get('unit', 1)))
                self.assertEqual(reply[7:].hex().upper() if reply else None, v['reply'])
                if reply:
                    self.assertEqual(reply[:2], b'\xab\xcd')
                    self.assertEqual(int.from_bytes(reply[4:6], 'big'), len(reply)-6)
                if 'area' in v:
                    self.assertEqual(server.status(dict(area=v['area'], offset=v['address'], limit=len(v['values'])))['values'], v['values'])

    def test_real_stream_and_lifecycle(self):
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            port = reserve.getsockname()[1]
        server = ModbusServer()
        config = dict(host='127.0.0.1',port=port,unit=1,start=0,count=100)
        try:
            server.start(config)
            server.set(dict(area='holding',address=0,values=[42]))
            with socket.create_connection(('127.0.0.1',port), timeout=2) as client:
                request = packet('0300000001',transaction=7)
                client.sendall(request[:3])
                time.sleep(.01)
                client.sendall(request[3:]+packet('060001007B',transaction=8)+packet('0300010001',transaction=9))
                expected = packet('0302002A',transaction=7)+packet('060001007B',transaction=8)+packet('0302007B',transaction=9)
                got = b''
                while len(got) < len(expected):
                    got += client.recv(260)
                self.assertEqual(got, expected)
                other = ModbusServer()
                with self.assertRaises(OSError):
                    other.start(config)
                self.assertFalse(other.status()['running'])
                server.stop()
                self.assertEqual(client.recv(1), b'')
            server.start(config)
            self.assertEqual(server.status()['values'][1],123)
            with socket.create_connection(('127.0.0.1',port), timeout=2) as client:
                client.sendall(bytes.fromhex('000100010006010300000001'))
                self.assertEqual(client.recv(1), b'')
            self.assertTrue(server.status()['running'])
        finally:
            server.stop()

    def test_invalid_edits_do_not_partially_write(self):
        server = ModbusServer()
        with self.assertRaises(ValueError):
            server.set(dict(area='coils',address=0,values=[1,2]))
        self.assertEqual(server.status(dict(area='coils'))['values'][:2],[0,0])
        with self.assertRaises(ValueError):
            server.set(dict(area='holding',address=99,values=[1,2]))
        with self.assertRaises(ValueError):
            server.action('__class__',{})

if __name__ == '__main__':
    unittest.main()
