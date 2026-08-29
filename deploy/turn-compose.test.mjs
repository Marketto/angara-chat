import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('trial TURN stays off the VPN port and is resource constrained', () => {
  assert.match(compose, /turn:\n[\s\S]*image: coturn\/coturn:4\.17\.2-r0/);
  assert.match(compose, /turn-edge:/);
  assert.match(compose, /TURN_LISTEN_IP[^\n]+:3478:3478\/udp/);
  assert.match(compose, /--listening-port=3478/);
  assert.match(compose, /--min-port=49160/);
  assert.match(compose, /--max-port=49175/);
  assert.match(compose, /--total-quota=4/);
  assert.match(compose, /--bps-capacity=128000/);
  assert.match(compose, /--no-stun/);
  assert.doesNotMatch(compose, /--no-loopback-peers/);
  assert.match(compose, /cap_add: \[NET_BIND_SERVICE\]/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /mem_limit: 96m/);
  assert.match(compose, /cpus: "0\.20"/);
  assert.doesNotMatch(compose, /--listening-port=443/);
  assert.doesNotMatch(compose, /--tls-listening-port=443/);
});
