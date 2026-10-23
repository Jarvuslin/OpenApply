import assert from "node:assert/strict";
import { test } from "node:test";
import { queueActivityPresented } from "./activity-visibility.mjs";

const visible = {
  viewport: { width: 1366, height: 768 },
  main: { top: 0, left: 230, bottom: 768, right: 1366 },
  title: { top: 40, left: 820, bottom: 65, right: 960 },
  close: { top: 40, left: 1140, bottom: 72, right: 1250 },
  focused: true,
};

test("activity must receive focus and show both its heading and Close control inside main", () => {
  assert.equal(queueActivityPresented(visible), true);
  assert.equal(queueActivityPresented({ ...visible, focused: false }), false);
  for (const key of ["title", "close"]) {
    for (const rect of [
      { top: -400, left: 820, bottom: -365, right: 960 },
      { top: -1, left: 820, bottom: 34, right: 960 },
      { top: 750, left: 820, bottom: 785, right: 960 },
      { top: 40, left: 220, bottom: 65, right: 360 },
      { top: 40, left: 820, bottom: 65, right: 1400 },
      { top: 40, left: 820, bottom: 40, right: 960 },
      { top: Number.NaN, left: 820, bottom: 65, right: 960 },
      null,
    ])
      assert.equal(queueActivityPresented({ ...visible, [key]: rect }), false);
  }
  assert.equal(queueActivityPresented({ ...visible, main: { ...visible.main, top: 50 } }), false);
});
