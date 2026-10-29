// Behavior tests for the bounded session registry (T10 / audit F-02, spec S2).
//
// The registry takes an injected `now`, so TTL and eviction are exercised on a
// fake clock: these tests never sleep and never touch real time.

import test from "node:test";
import assert from "node:assert/strict";

import { SessionRegistry } from "../dist/sessions.js";

/** Session stand-in that only records how often it was closed. */
function fakeSession() {
  return {
    closed: 0,
    close() {
      this.closed += 1;
    },
  };
}

const TTL = 100;

test("open refuses to exceed the cap and leaves the map at the cap", () => {
  let clock = 0;
  const sessions = new SessionRegistry(2, TTL, () => clock);
  const a = fakeSession();
  const b = fakeSession();
  const c = fakeSession();

  assert.equal(sessions.open("a", a), true);
  assert.equal(sessions.open("b", b), true);
  assert.equal(sessions.open("c", c), false);

  assert.equal(sessions.size, 2);
  assert.deepEqual(sessions.ids(), ["a", "b"]);
  // The refused session is never closed by the registry: it was never stored.
  assert.equal(c.closed, 0);
});

test("get on an idle session past the TTL closes it and returns nothing", () => {
  let clock = 0;
  const sessions = new SessionRegistry(4, TTL, () => clock);
  const a = fakeSession();
  sessions.open("a", a);

  clock = TTL + 1;
  assert.equal(sessions.get("a"), undefined);
  assert.equal(sessions.size, 0);
  assert.equal(a.closed, 1);
});

test("get refreshes the idle timer, so an active session does not expire", () => {
  let clock = 0;
  const sessions = new SessionRegistry(4, TTL, () => clock);
  const a = fakeSession();
  sessions.open("a", a);

  clock = 90;
  assert.equal(sessions.get("a"), a); // refreshes lastSeen to 90
  clock = 150;
  assert.equal(sessions.get("a"), a); // 60ms idle: still alive, refreshes to 150
  clock = 260;
  assert.equal(sessions.get("a"), undefined); // 110ms idle: expired
  assert.equal(a.closed, 1);
  assert.equal(sessions.size, 0);
});

test("sweep closes only expired entries and leaves fresh ones alone", () => {
  let clock = 0;
  const sessions = new SessionRegistry(4, TTL, () => clock);
  const a = fakeSession();
  const b = fakeSession();
  sessions.open("a", a);
  sessions.open("b", b);

  // Refresh b halfway; a stays untouched and is the only idle one at t=120.
  // (No open()/canOpen() in between: those reclaim expired entries eagerly.)
  clock = 60;
  assert.equal(sessions.get("b"), b);

  clock = 120; // a: 120ms idle (expired) / b: 60ms idle (fresh)
  assert.deepEqual(sessions.sweep(), ["a"]);
  assert.equal(a.closed, 1);
  assert.equal(b.closed, 0);
  assert.equal(sessions.size, 1);
  assert.deepEqual(sessions.ids(), ["b"]);
  assert.equal(sessions.get("b"), b);
});

test("expired entries release their slot instead of blocking a new session", () => {
  let clock = 0;
  const sessions = new SessionRegistry(1, TTL, () => clock);
  const a = fakeSession();
  assert.equal(sessions.open("a", a), true);

  clock = TTL + 1;
  // A full-but-stale registry must admit the newcomer: expired entries do not
  // occupy a slot.
  assert.equal(sessions.canOpen(), true);
  assert.equal(a.closed, 1);
  assert.equal(sessions.size, 0);

  const b = fakeSession();
  assert.equal(sessions.open("b", b), true);
  assert.deepEqual(sessions.ids(), ["b"]);
});

test("touch keeps a session alive only while it has not expired", () => {
  let clock = 0;
  const sessions = new SessionRegistry(4, TTL, () => clock);
  const a = fakeSession();
  sessions.open("a", a);

  clock = 80;
  sessions.touch("a"); // refreshes to 80
  clock = 170;
  assert.equal(sessions.size, 1); // 90ms idle: alive
  sessions.touch("a"); // refreshes to 170
  clock = 180;
  assert.equal(sessions.get("a"), a);

  clock = 400; // 230ms idle
  sessions.touch("a"); // must NOT resurrect an expired entry
  assert.deepEqual(sessions.sweep(), ["a"]);
  assert.equal(a.closed, 1);
});
