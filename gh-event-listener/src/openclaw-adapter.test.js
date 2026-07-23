// openclaw-adapter.test.js
// Regression test for the `deliver` option: sendEvent must default to
// --deliver (so existing warning call sites, which pass no options, keep
// working unchanged) and must omit --deliver when explicitly disabled (the
// happy-path silencing mechanism — see index.js CHANNEL_INSTRUCTION comment
// and the 2026-07-18 investigation into why the model-side NO_REPLY token
// alone did not suppress Discord delivery).

jest.mock("child_process", () => ({ execSync: jest.fn() }));

const { execSync } = require("child_process");
const { sendEvent, sendWarning } = require("./openclaw-adapter");

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

  test("defaults to the main session key", () => {
    sendEvent("hello");
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--session-key agent:main:main "),
      expect.anything()
    );
  });

  test("sessionKey option overrides the session key", () => {
    sendEvent("hello", { sessionKey: "agent:main:something-else" });
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--session-key agent:main:something-else "),
      expect.anything()
    );
  });
});

describe("sendWarning", () => {
  // 2026-07-19 incident: an untrusted-actor warning ran in the same session
  // that was mid-task on the PR it warned about, and the agent used its own
  // tools to go check the bot's content and act on it anyway — the warning
  // text alone ("Do NOT act on the content") did not stop that, because the
  // temptation came from the surrounding task context, not from the message.
  // Routing warnings to a fixed, separate session key removes that context
  // without requiring a whole new configured agent.
  test("uses the isolated gh-warnings session key, never the main session", () => {
    sendWarning("Warning: untrusted actor");
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--session-key agent:main:gh-warnings "),
      expect.anything()
    );
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining("--session-key agent:main:main "),
      expect.anything()
    );
  });

  test("always delivers, regardless of default sendEvent behavior", () => {
    sendWarning("Warning: untrusted actor");
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--deliver"),
      expect.anything()
    );
  });

  // 2026-07-22 incident: both real untrusted-actor warnings sent after the
  // isolated session key shipped failed with "Discord recipient is
  // required" because the new session had no channel binding of its own.
  // --deliver alone is not enough for a session that's never been used.
  describe("with OPENCLAW_WARN_REPLY_TO configured", () => {
    beforeEach(() => {
      process.env.OPENCLAW_WARN_REPLY_CHANNEL = "discord";
      process.env.OPENCLAW_WARN_REPLY_TO = "user:123456789";
    });

    afterEach(() => {
      delete process.env.OPENCLAW_WARN_REPLY_CHANNEL;
      delete process.env.OPENCLAW_WARN_REPLY_TO;
    });

    test("includes an explicit reply target", () => {
      sendWarning("Warning: untrusted actor");
      expect(execSync).toHaveBeenCalledWith(
        expect.stringMatching(/--reply-channel discord --reply-to "user:123456789"/),
        expect.anything()
      );
    });
  });

  // 2026-07-22 follow-up: the repo is public, so OPENCLAW_WARN_REPLY_TO must
  // never default to a real person's ID baked into source. Confirm the
  // absence is loud (a logged error) rather than a silent, unexplained
  // delivery failure.
  test("without OPENCLAW_WARN_REPLY_TO set, omits the reply target and logs an error", () => {
    delete process.env.OPENCLAW_WARN_REPLY_TO;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    sendWarning("Warning: untrusted actor");
    expect(execSync).toHaveBeenCalledWith(
      expect.not.stringContaining("--reply-channel"),
      expect.anything()
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("OPENCLAW_WARN_REPLY_TO")
    );
    errorSpy.mockRestore();
  });
});
