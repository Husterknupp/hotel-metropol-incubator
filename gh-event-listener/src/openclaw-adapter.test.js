// openclaw-adapter.test.js
// Regression test for the `deliver` option: sendEvent must default to
// --deliver (so existing warning call sites, which pass no options, keep
// working unchanged) and must omit --deliver when explicitly disabled (the
// happy-path silencing mechanism — see index.js CHANNEL_INSTRUCTION comment
// and the 2026-07-18 investigation into why the model-side NO_REPLY token
// alone did not suppress Discord delivery).

jest.mock("child_process", () => ({ execSync: jest.fn() }));

const { execSync } = require("child_process");
const { sendEvent } = require("./openclaw-adapter");

beforeEach(() => {
  execSync.mockClear();
});

describe("sendEvent", () => {
  test("defaults to --deliver when no options are passed", () => {
    sendEvent("hello");
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--deliver"),
      expect.anything()
    );
  });

  test("deliver: true explicitly still includes --deliver", () => {
    sendEvent("hello", { deliver: true });
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--deliver"),
      expect.anything()
    );
  });

  test("deliver: false omits --deliver so the turn runs silently on the main session", () => {
    sendEvent("hello", { deliver: false });
    expect(execSync).toHaveBeenCalledWith(
      expect.not.stringContaining("--deliver"),
      expect.anything()
    );
  });
});
