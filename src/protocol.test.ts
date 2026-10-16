import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer, IncomingMessage } from 'node:http';
import { seedData } from './domain';
import { toWireConfig } from './protocol';
import { getStatus, normalizeBase, putConfig, testBox } from './deviceClient';

describe('device payload', () => {
  it('omits photos and keeps ids/boxes', () => {
    const data = seedData();
    data.profiles[0]!.faceUri = 'data:image/png;base64,AAAA';
    const wire = toWireConfig(data, 3);
    assert.equal(wire.revision, 3);
    assert.ok(!JSON.stringify(wire).includes('data:image'));
    assert.equal(wire.medicines.length, data.medicines.length);
  });

  async function withDevice(
    reply: (request: IncomingMessage) => { status: number; body: object },
    test: (base: string) => Promise<void>,
  ) {
    const server = createServer((request, response) => {
      const result = reply(request);
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result.body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try { await test(`http://127.0.0.1:${address.port}`); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }

  describe('real device HTTP transport', () => {
    it('sends one authorized POST per requested box and waits for completion', async () => {
      const seen: string[] = [];
      await withDevice(request => {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.authorization, 'Bearer test-device-token');
        seen.push(request.url ?? '');
        return { status: 200, body: { ok: true } };
      }, async base => {
        for (const box of [1, 2, 3, 4]) await testBox(base, box, 'test-device-token');
      });
      assert.deepEqual(seen, [1, 2, 3, 4].map(box => `/api/test-open?box=${box}`));
    });
    it('rejects invalid boxes or missing credentials without sending commands', async () => {
      let requests = 0;
      await withDevice(() => {
        requests++;
        return { status: 200, body: { ok: true } };
      }, async base => {
        for (const box of [0, 5, 1.5, NaN]) await assert.rejects(testBox(base, box, 'token'));
        await assert.rejects(testBox(base, 1, ''), /토큰/);
      });
      assert.equal(requests, 0);
    });
    it('surfaces inspection locks and timeouts without retrying', async () => {
      for (const status of [409, 504]) {
        let requests = 0;
        await withDevice(() => {
          requests++;
          return { status, body: { ok: false, detail: 'Inspect tray; do not retry.' } };
        }, async base => { await assert.rejects(testBox(base, 1, 'token'), /Inspect tray/); });
        assert.equal(requests, 1);
      }
    });
    it('does not report unsupported schedule sync as successful', async () => {
      await withDevice(() => ({
        status: 501, body: { ok: false, detail: 'Schedule autonomy is unsupported.' },
      }), async base => {
        await assert.rejects(putConfig(base, toWireConfig(seedData(), 1), 'token'), /501.*unsupported/);
      });
    });
    it('reports unsupported camera integration and missing GPIO honestly', async () => {
      await withDevice(() => ({
        status: 200, body: {
          v: 1, revision: 0, rtc: '', uno: false, uartReady: false,
          inspectionRequired: true, busy: false, cameraReady: false,
          visionMode: 'not-integrated', faceId: -1, objectId: -1, autonomy: false,
        },
      }), async base => {
        const status = await getStatus(base);
        assert.equal(status.uartReady, false);
        assert.equal(status.inspectionRequired, true);
        assert.equal(status.cameraReady, false);
        assert.equal(status.visionMode, 'not-integrated');
        assert.equal(status.faceId, -1);
        assert.equal(status.objectId, -1);
        assert.equal(status.autonomy, false);
      });
    });
  });
  it('only accepts plain http host addresses', () => {
    assert.equal(normalizeBase(' http://192.168.0.20/ '), 'http://192.168.0.20');
    assert.throws(() => normalizeBase('https://evil.example/x'));
    assert.throws(() => normalizeBase('192.168.0.20'));
  });
});
