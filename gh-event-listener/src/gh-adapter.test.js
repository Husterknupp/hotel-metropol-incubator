// gh-adapter.test.js
// Behavioural regression test for shell-quoting of gh api arguments.
//
// Background: gh-adapter passes command strings to child_process.execSync,
// which runs them through `sh -c`. Any unquoted `&` in a URL query string is
// interpreted by the shell as a background-process operator, silently dropping
// the following query parameters. This once caused getLatestPrReviewComment to
// return the first comment (by diff position) instead of the newest one,
// because `sort=created&direction=desc` never reached gh.
//
// The previous version of this file mocked execSync and re-implemented shell
// quoting rules to assert "the command string looks quoted". That was close to
// tautological: a green run only proved the string matched our own parser, not
// that a real shell keeps the `&` inside the argument. Instead we reproduce the
// real failure mode — put a fake `gh` on PATH that records the argv it actually
// receives, and let the real `execSync → sh -c` do the tokenizing. A green test
// therefore proves the shell kept the whole query string as ONE argument.
//
// Why a child node process? The adapter calls `execSync("gh …")` with no `env`
// option, so it inherits the real process environment's PATH. Under jest each
// test module gets its OWN sandboxed `process.env`; mutating `process.env.PATH`
// here does NOT reach that un-optioned execSync, so the fake `gh` would never be
// found and the real one would run. We therefore run the adapter call in a real
// child `node` process whose PATH we control explicitly — there the adapter's
// bare `gh` resolves to our fake, and the real shell does the tokenizing.
//
// Note: this shells out for real, so it needs a POSIX `sh` and a `node` on PATH
// (fine on the Linux runner; a Windows CI would need a guard).

const { execSync } = require("child_process");
const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ADAPTER = path.resolve(__dirname, "gh-adapter.js");

/**
 * Runs `require("./gh-adapter").<adapterCall>` inside a child node process with
 * a fake `gh` first on PATH. The fake records every argument it receives (one
 * per line) and prints `[]` as valid JSON. Returns the argv the shell actually
 * handed to `gh` after parsing the adapter's command string.
 */
function argvSeenByGh(adapterCall) {
  const dir = mkdtempSync(path.join(tmpdir(), "ghfake-"));
  const out = path.join(dir, "argv.txt");
  writeFileSync(
    path.join(dir, "gh"),
    `#!/bin/sh\n: > "${out}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${out}"; done\nprintf '[]'\n`
  );
  chmodSync(path.join(dir, "gh"), 0o755);

  const script = `require(${JSON.stringify(ADAPTER)}).${adapterCall}`;
  execSync(`node -e ${JSON.stringify(script)}`, {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: "utf8",
  });
  return readFileSync(out, "utf8").trim().split("\n");
}

describe("gh api query strings survive a real shell", () => {
  const args = { owner: "Husterknupp", repo: "hotel-metropol-incubator", prNumber: "3" };

  // These are the two calls whose correctness depends on the query string
  // (sort/direction) surviving intact; they share the same quoting idiom as
  // every other `gh api '…'` call in the adapter, so a regression there would
  // show up here too.
  test("getLatestPrReviewComment sends the full query string as one argument", () => {
    const argv = argvSeenByGh(`getLatestPrReviewComment(${JSON.stringify(args)})`);
    // If the `&` were exposed to the shell, gh would only ever see
    // "…?per_page=1" and the sort/direction params would be lost.
    expect(argv).toContain(
      "repos/Husterknupp/hotel-metropol-incubator/pulls/3/comments?per_page=1&sort=created&direction=desc"
    );
  });

  test("getPrReviewComments (issue #8 batch fetch) also survives the shell", () => {
    const argv = argvSeenByGh(`getPrReviewComments(${JSON.stringify(args)})`);
    expect(argv).toContain(
      "repos/Husterknupp/hotel-metropol-incubator/pulls/3/comments?per_page=100&sort=created&direction=asc"
    );
  });
});
