import { createSessionBoundary } from "./session-boundary";
import { eventually, TransportFixture } from "./transport-fakes";
import { expect, test } from "bun:test";

test("an auth boundary resets both tabs without broadcasting user information", async () => {
  const fixture = new TransportFixture();
  const firstEvents: boolean[] = [];
  const secondEvents: boolean[] = [];
  let firstResets = 0;
  let secondResets = 0;
  const first = createSessionBoundary(fixture.platform().channel("auth"), () => {
    firstResets++;
  });
  const second = createSessionBoundary(fixture.platform().channel("auth"), () => {
    secondResets++;
  });
  const stopFirst = first.subscribe((remote) => firstEvents.push(remote));
  const stopSecond = second.subscribe((remote) => secondEvents.push(remote));
  first.announce();
  await eventually(() => secondEvents.length > 0);
  expect(firstEvents).toEqual([false]);
  expect(secondEvents).toEqual([true]);
  expect(firstResets).toBe(1);
  expect(secondResets).toBe(1);
  stopFirst();
  stopSecond();
  first.dispose();
  second.dispose();
  expect([...fixture.channels.values()].every((members) => members.size === 0)).toBe(true);
});
