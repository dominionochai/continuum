import test from 'node:test';
import assert from 'node:assert/strict';
import { Continuum } from './health.ts';

let t = 0;
const make = () => { t = 0; return new Continuum({ now: () => t, timeoutMs: 50 }); };
const ok = (v: string) => async () => v;
const fail = (msg: string) => async () => { throw new Error(msg); };

test('healthy device never touches the cloud', async () => {
  const r = await make().run(ok('device'), fail('cloud must not run'));
  assert.deepEqual(r, { value: 'device', source: 'device' });
});

test('a failing device is tried once, skipped while trusted, probed after expiry', async () => {
  const c = make();
  let attempts = 0;
  const device = async () => { attempts++; throw new Error('boom'); };
  for (let i = 0; i < 10; i++) assert.equal((await c.run(device, ok('cloud'))).source, 'cloud');
  assert.equal(attempts, 1);
  t += 16_000; // inference trust is 15s
  await c.run(device, ok('cloud'));
  assert.equal(attempts, 2);
  assert.equal(c.health?.confidence, 0.75); // two agreeing failures
});

test('a hung device is cut off and classified as a timeout', async () => {
  const c = make();
  const r = await c.run(() => new Promise<string>(() => {}), ok('cloud'));
  assert.equal(r.source, 'cloud');
  assert.equal(c.health?.kind, 'timeout');
});

test('quota failures are trusted far longer than inference errors', async () => {
  const c = make();
  await c.run(fail('quota exceeded'), ok('cloud'));
  assert.equal(c.health?.kind, 'quota');
  assert.equal(c.health!.expiresAt - c.health!.at, 300_000);
});

test('device recovers after a successful probe', async () => {
  const c = make();
  await c.run(fail('boom'), ok('cloud'));
  t += 16_000;
  assert.equal((await c.run(ok('device'), ok('cloud'))).source, 'device');
  assert.equal(c.health?.healthy, true);
  assert.deepEqual(c.trace.map((e) => e.event), ['device-failed', 'probe', 'device-ok']);
});

test('a failing cloud still surfaces its error', async () => {
  await assert.rejects(make().run(fail('device'), fail('cloud down')), /cloud down/);
});
