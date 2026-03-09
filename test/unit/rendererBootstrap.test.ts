import { describe, expect, it, vi } from "vitest";

import { bootstrapRenderer } from "../../src/rendererBootstrap.js";

describe("bootstrapRenderer", () => {
  it("runs renderer bootstrap steps in order and waits for initial loading before starting monitors", async () => {
    const calls: string[] = [];
    let resolveInitialLoad: (() => void) | null = null;

    const bootstrapPromise = bootstrapRenderer({
      ensureApi: vi.fn(() => {
        calls.push("ensureApi");
      }),
      setButtons: vi.fn(() => {
        calls.push("setButtons");
      }),
      updateAutoUi: vi.fn(() => {
        calls.push("updateAutoUi");
      }),
      clearSessionDetail: vi.fn(() => {
        calls.push("clearSessionDetail");
      }),
      registerTabNavigation: vi.fn(() => {
        calls.push("registerTabNavigation");
      }),
      activateTab: vi.fn((tabId: string) => {
        calls.push(`activateTab:${tabId}`);
      }),
      registerUiEventHandlers: vi.fn(() => {
        calls.push("registerUiEventHandlers");
      }),
      registerRealtimeSubscriptions: vi.fn(() => {
        calls.push("registerRealtimeSubscriptions");
      }),
      registerBeforeUnloadHandler: vi.fn(() => {
        calls.push("registerBeforeUnloadHandler");
      }),
      runInitialLoadSequence: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls.push("runInitialLoadSequence");
            resolveInitialLoad = resolve;
          }),
      ),
      startAutoMonitor: vi.fn(() => {
        calls.push("startAutoMonitor");
      }),
      log: vi.fn((message: string) => {
        calls.push(`log:${message}`);
      }),
    });

    expect(calls).toEqual([
      "ensureApi",
      "setButtons",
      "updateAutoUi",
      "clearSessionDetail",
      "registerTabNavigation",
      "activateTab:capture",
      "registerUiEventHandlers",
      "registerRealtimeSubscriptions",
      "registerBeforeUnloadHandler",
      "runInitialLoadSequence",
    ]);

    resolveInitialLoad?.();
    await bootstrapPromise;

    expect(calls).toEqual([
      "ensureApi",
      "setButtons",
      "updateAutoUi",
      "clearSessionDetail",
      "registerTabNavigation",
      "activateTab:capture",
      "registerUiEventHandlers",
      "registerRealtimeSubscriptions",
      "registerBeforeUnloadHandler",
      "runInitialLoadSequence",
      "startAutoMonitor",
      "log:Coview M5 ready.",
    ]);
  });

  it("does not start monitoring when the initial load sequence fails", async () => {
    const startAutoMonitor = vi.fn();
    const log = vi.fn();

    await expect(
      bootstrapRenderer({
        ensureApi: vi.fn(),
        setButtons: vi.fn(),
        updateAutoUi: vi.fn(),
        clearSessionDetail: vi.fn(),
        registerTabNavigation: vi.fn(),
        activateTab: vi.fn(),
        registerUiEventHandlers: vi.fn(),
        registerRealtimeSubscriptions: vi.fn(),
        registerBeforeUnloadHandler: vi.fn(),
        runInitialLoadSequence: vi.fn(async () => {
          throw new Error("initial load failed");
        }),
        startAutoMonitor,
        log,
      }),
    ).rejects.toThrow("initial load failed");

    expect(startAutoMonitor).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
