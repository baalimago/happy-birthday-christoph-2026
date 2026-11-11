import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDone, unlockedViews } from './objectives.js';

const start = { found: [], views: 1, sailed: false };
const PORT_VIEWS = { wittgenstein: 'gold', juniper: 'chart', dioxus: 'terminal' };

test('sail is done once the boat has moved', () => {
  assert.equal(isDone('sail', start), false);
  assert.equal(isDone('sail', { ...start, sailed: true }), true);
});

test('port:<id> is done when that port is found', () => {
  const progress = { ...start, found: ['juniper'] };
  assert.equal(isDone('port:juniper', progress), true);
  assert.equal(isDone('port:wittgenstein', progress), false);
  assert.equal(isDone('port:', progress), false);
});

test('ports:<n> is done at n ports or more', () => {
  const progress = { ...start, found: ['a', 'b', 'c'] };
  assert.equal(isDone('ports:3', progress), true);
  assert.equal(isDone('ports:2', progress), true);
  assert.equal(isDone('ports:4', progress), false);
  assert.equal(isDone('ports:0', start), true);
});

test('views:<n> counts the poster', () => {
  assert.equal(isDone('views:1', start), true);
  assert.equal(isDone('views:4', { ...start, views: 3 }), false);
  assert.equal(isDone('views:4', { ...start, views: 4 }), true);
});

test('unknown or malformed goals are never done', () => {
  const all = { found: ['a', 'b', 'c', 'd', 'e', 'f'], views: 4, sailed: true };
  for (const goal of ['', 'fly', 'sail:now', 'ports', 'ports:', 'ports:many', 'views:-1', 'port']) {
    assert.equal(isDone(goal, all), false, goal);
  }
});

test('unlockedViews starts with the poster and keeps shader order', () => {
  assert.deepEqual(unlockedViews([], PORT_VIEWS), ['poster']);
  assert.deepEqual(unlockedViews(['quickjs'], PORT_VIEWS), ['poster']);
  assert.deepEqual(unlockedViews(['juniper', 'wittgenstein'], PORT_VIEWS), [
    'poster',
    'gold',
    'chart',
  ]);
  assert.deepEqual(unlockedViews(['juniper', 'dioxus', 'wittgenstein'], PORT_VIEWS), [
    'poster',
    'terminal',
    'gold',
    'chart',
  ]);
});

test('unlockedViews ignores views it does not know and inherited keys', () => {
  assert.deepEqual(unlockedViews(['x', 'toString'], { x: 'sepia' }), ['poster']);
});
