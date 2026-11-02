import { describe, expect, it } from "vitest";
import {
  createBatcher,
  createCoalescedRunner,
  directoriesToRefresh,
  type RefreshTimers,
} from "./refresh-scheduler";

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: RefreshTimers = {
    set: (callback) => {
      pending.set(++next, callback);
      return next;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    size: () => pending.size,
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createCoalescedRunner", () => {
  it("collapses a burst of 50 requests into a single run", async () => {
    const fake = fakeTimers();
    let runs = 0;
    const runner = createCoalescedRunner(() => void runs++, 300, fake.timers);
    for (let index = 0; index < 50; index++) runner.request();
    expect(fake.size()).toBe(1);
    fake.fire();
    await tick();
    expect(runs).toBe(1);
  });

  it("runs once more when a request arrives during an in-flight run", async () => {
    const fake = fakeTimers();
    let runs = 0;
    let release: () => void = () => undefined;
    const runner = createCoalescedRunner(
      () =>
        ++runs === 1
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : undefined,
      300,
      fake.timers,
    );
    runner.request();
    fake.fire();
    runner.request();
    runner.request();
    expect(runs).toBe(1);
    release();
    await tick();
    fake.fire();
    await tick();
    expect(runs).toBe(2);
  });

  it("does nothing after cancel", async () => {
    const fake = fakeTimers();
    let runs = 0;
    const runner = createCoalescedRunner(() => void runs++, 300, fake.timers);
    runner.request();
    runner.cancel();
    fake.fire();
    runner.request();
    await tick();
    expect(runs).toBe(0);
  });
});

describe("directoriesToRefresh", () => {
  const cwd = "/repo";
  it("refreshes only listings whose directory contains a change", () => {
    expect(directoriesToRefresh(["/repo/src/a.ts"], cwd, ["/repo/src", "/repo/docs"])).toEqual({
      root: false,
      dirs: ["/repo/src"],
    });
  });
  it("refreshes the root for top-level changes and ignores unloaded directories", () => {
    expect(directoriesToRefresh(["/repo/new.txt"], cwd, ["/repo/src"])).toEqual({
      root: true,
      dirs: [],
    });
  });
  it("refreshes everything when the platform gives no filename", () => {
    expect(directoriesToRefresh([], cwd, ["/repo/src"])).toEqual({
      root: true,
      dirs: ["/repo/src"],
    });
  });
  it("handles Windows separators", () => {
    expect(
      directoriesToRefresh(["C:\\repo\\src\\a.ts"], "C:/repo", ["C:\\repo\\src"]).dirs,
    ).toEqual(["C:\\repo\\src"]);
  });
});

describe("createBatcher", () => {
  it("leading mode delivers the first item at once and batches the rest in order", () => {
    const fake = fakeTimers();
    const batches: number[][] = [];
    const batcher = createBatcher<number>((batch) => batches.push(batch), 32, fake.timers, {
      leading: true,
    });
    batcher.push(1);
    expect(batches).toEqual([[1]]);
    batcher.push(2);
    batcher.push(3);
    expect(batches).toEqual([[1]]);
    fake.fire();
    expect(batches).toEqual([[1], [2, 3]]);
    batcher.push(4);
    expect(batches).toEqual([[1], [2, 3], [4]]);
  });
  it("delivers a burst once, in order, without losing items", () => {
    const fake = fakeTimers();
    const batches: number[][] = [];
    const batcher = createBatcher<number>((batch) => batches.push(batch), 32, fake.timers);
    for (let index = 0; index < 100; index++) batcher.push(index);
    expect(batches).toHaveLength(0);
    fake.fire();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(Array.from({ length: 100 }, (_, index) => index));
  });

  it("discard drops queued items and cancels delivery", () => {
    const fake = fakeTimers();
    const batches: number[][] = [];
    const batcher = createBatcher<number>((batch) => batches.push(batch), 32, fake.timers);
    batcher.push(1);
    batcher.discard();
    fake.fire();
    expect(batches).toEqual([]);
  });
});
