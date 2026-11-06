"""Modbus TCP slave: explicit listener, bounded register bank, standard library only."""
import collections
import datetime
import ipaddress
import socket
import struct
import threading

AREAS = ('coils', 'discrete', 'holding', 'input')

def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('Parameter out of range')
    return value

class ModbusServer:
    def __init__(self):
        self.config = dict(host='127.0.0.1', port=1502, unit=1, start=0, count=100)
        self.banks = {key: [0] * 100 for key in AREAS}
        self.lock = threading.RLock()
        self.listener = None
        self.clients = set()
        self.logs = collections.deque(maxlen=100)
        self.cursor = self.requests = self.responses = self.writes = 0
        self.error = ''

    def log(self, kind, peer='', data=b'', message=''):
        self.cursor += 1
        self.logs.append(dict(id=self.cursor, time=datetime.datetime.now(datetime.timezone.utc).isoformat(), kind=kind, peer=peer, hex=data.hex().upper(), message=message))

    def status(self, data=None):
        data = data or {}
        with self.lock:
            c = self.config
            area = data.get('area', 'holding')
            offset = integer(data.get('offset', c['start']), c['start'], c['start'] + c['count'] - 1)
            limit = integer(data.get('limit', 64), 1, 128)
            after = integer(data.get('after', 0), 0, 9007199254740991)
            if area not in AREAS:
                raise ValueError('Invalid data area')
            return dict(c, running=self.listener is not None, clients=len(self.clients), requests=self.requests, responses=self.responses, writes=self.writes, error=self.error, area=area, offset=offset, values=self.banks[area][offset-c['start']:offset-c['start']+limit], logs=[x for x in self.logs if x['id'] > after], cursor=self.cursor)

    def set(self, data):
        with self.lock:
            area, address, values = data.get('area'), data.get('address'), data.get('values')
            if area not in AREAS or type(values) is not list or not 1 <= len(values) <= 128:
                raise ValueError('Select an area and provide 1-128 values')
            integer(address, self.config['start'], self.config['start'] + self.config['count'] - len(values))
            for value in values:
                integer(value, 0, 1 if area in AREAS[:2] else 65535)
            self.banks[area][address-self.config['start']:address-self.config['start']+len(values)] = values
            self.log('SYS', message='Set {} address {}, {} values'.format(area, address, len(values)))
            return {'ok': True}

    def start(self, data):
        config = dict(host=str(data.get('host', '')), port=integer(data.get('port'), 1, 65535), unit=integer(data.get('unit'), 1, 247), start=integer(data.get('start'), 0, 65535), count=integer(data.get('count'), 1, 4096))
        ipaddress.IPv4Address(config['host'])
        if config['start'] + config['count'] > 65536:
            raise ValueError('Address range exceeds 65535')
        with self.lock:
            if self.listener:
                raise ValueError('Stop the current listener first')
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind((config['host'], config['port']))
                listener.listen(16)
                listener.settimeout(0.5)
            except OSError:
                listener.close()
                raise
            if config['start'] != self.config['start'] or config['count'] != self.config['count']:
                self.banks = {key: [0] * config['count'] for key in AREAS}
            self.config = config
            self.listener = listener
            self.requests = self.responses = self.writes = 0
            self.error = ''
            self.log('SYS', message='Listening on {}:{}'.format(config['host'], config['port']))
            threading.Thread(target=self.accept, args=(listener,), daemon=True).start()
            return {'ok': True}

    def stop(self, data=None):
        with self.lock:
            listener, self.listener = self.listener, None
            for client in self.clients:
                try:
                    client.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                client.close()
            self.clients.clear()
            if listener:
                listener.close()
                self.log('SYS', message='Listener stopped')
        return {'ok': True}

    def clear(self, data=None):
        with self.lock:
            self.logs.clear()
        return {'ok': True}

    def action(self, action, data):
        if action not in ('start', 'stop', 'status', 'set', 'clear'):
            raise ValueError('Invalid server action')
        return getattr(self, action)(data)

    def accept(self, listener):
        while True:
            try:
                client, address = listener.accept()
            except socket.timeout:
                with self.lock:
                    if self.listener is not listener:
                        return
                continue
            except OSError:
                return
            with self.lock:
                if self.listener is not listener or len(self.clients) >= 16:
                    client.close()
                    continue
                self.clients.add(client)
                threading.Thread(target=self.serve, args=(client, '{}:{}'.format(*address)), daemon=True).start()

    def serve(self, client, peer):
        with self.lock:
            self.log('SYS', peer, message='Client connected')
        buffer = b''
        try:
            client.settimeout(60)
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                buffer += chunk
                while len(buffer) >= 6:
                    _, protocol, length = struct.unpack('>HHH', buffer[:6])
                    if protocol or not 2 <= length <= 254:
                        raise ValueError('Invalid MBAP header')
                    if len(buffer) < 6 + length:
                        break
                    frame, buffer = buffer[:6+length], buffer[6+length:]
                    with self.lock:
                        reply = self.handle(frame, peer)
                    if reply:
                        client.sendall(reply)
        except (OSError, ValueError) as error:
            with self.lock:
                self.log('SYS', peer, message=str(error))
        finally:
            client.close()
            with self.lock:
                self.clients.discard(client)
                self.log('SYS', peer, message='Client disconnected')

    def handle(self, frame, peer=''):
        self.requests += 1
        self.log('RX', peer, frame)
        if frame[6] != self.config['unit']:
            return None
        pdu, fc = frame[7:], frame[7]
        exception = lambda code: bytes([fc | 128, code])
        if fc not in (1, 2, 3, 4, 5, 6, 15, 16):
            reply = exception(1)
        elif len(pdu) < 5:
            reply = exception(3)
        else:
            address, quantity = struct.unpack('>HH', pdu[1:5])
            index = address - self.config['start']
            in_range = lambda count: index >= 0 and index + count <= self.config['count']
            if fc <= 4:
                if len(pdu) != 5 or not 1 <= quantity <= (2000 if fc <= 2 else 125):
                    reply = exception(3)
                elif not in_range(quantity):
                    reply = exception(2)
                else:
                    values = self.banks[AREAS[fc-1]][index:index+quantity]
                    data = bytearray((quantity+7)//8 if fc <= 2 else quantity*2)
                    for i, value in enumerate(values):
                        if fc <= 2:
                            data[i//8] |= value << (i % 8)
                        else:
                            struct.pack_into('>H', data, i*2, value)
                    reply = bytes([fc, len(data)]) + data
            elif fc in (5, 6):
                if len(pdu) != 5 or fc == 5 and quantity not in (0, 0xff00):
                    reply = exception(3)
                elif not in_range(1):
                    reply = exception(2)
                else:
                    self.banks['coils' if fc == 5 else 'holding'][index] = int(quantity == 0xff00) if fc == 5 else quantity
                    self.writes += 1
                    reply = pdu
            else:
                count = (quantity+7)//8 if fc == 15 else quantity*2
                if not 1 <= quantity <= (1968 if fc == 15 else 123) or len(pdu) != 6+count or pdu[5] != count:
                    reply = exception(3)
                elif not in_range(quantity):
                    reply = exception(2)
                else:
                    bank = self.banks['coils' if fc == 15 else 'holding']
                    for i in range(quantity):
                        bank[index+i] = (pdu[6+i//8] >> (i % 8)) & 1 if fc == 15 else struct.unpack_from('>H', pdu, 6+i*2)[0]
                    self.writes += 1
                    reply = pdu[:5]
        result = frame[:4] + struct.pack('>H', len(reply)+1) + frame[6:7] + reply
        self.responses += 1
        self.log('TX', peer, result)
        return result
