import assert from "node:assert/strict";
import test from "node:test";
import { browserCommands } from "./browser-options.mjs";
import { guestCommand } from "./runtime.mjs";

test("browser defaults keep the standard guest port and workspace", () => {
  assert.deepEqual(browserCommands({}), {
    prepare: [
      ["mkdir", "-p", "--", "/home/pilot/openapply"],
      ["chown", "pilot:pilot", "--", "/home/pilot/openapply"],
    ],
    launch: [
      "sh",
      "-c",
      'cd "$1" && shift && exec "$@"',
      "openapply-browser",
      "/home/pilot/openapply",
      "node",
      "/home/pilot/openapply-tools/node_modules/@playwright/mcp/cli.js",
      "--cdp-endpoint",
      "http://127.0.0.1:9222",
      "--output-dir",
      "/home/pilot/openapply",
    ],
  });
});

test("dedicated browser settings change only the loopback port and guest output directory", () => {
  const outputDir = "/home/pilot/openapply/apply-e2e/run-1/browser";
  const commands = browserCommands({
    OPENAPPLY_BROWSER_CDP_PORT: "19222",
    OPENAPPLY_BROWSER_OUTPUT_DIR: outputDir,
  });
  assert.deepEqual(commands.prepare, [
    ["mkdir", "-p", "--", outputDir],
    ["chown", "pilot:pilot", "--", outputDir],
  ]);
  assert.ok(commands.launch.includes("http://127.0.0.1:19222"));
  assert.equal(commands.launch[4], outputDir);
  assert.equal(commands.launch.at(-1), outputDir);
  assert.equal(commands.launch[2], 'cd "$1" && shift && exec "$@"');
  assert.ok(!commands.launch[2].includes(outputDir));
  for (const backend of ["wsl", "lima"]) {
    const launched = guestCommand({ backend }, commands.launch, "pilot");
    assert.deepEqual(launched.slice(-commands.launch.length), commands.launch);
    assert.equal(launched.filter((argument) => argument === outputDir).length, 2);
  }
});

test("browser port boundaries are valid and non-integer or injected ports are rejected", () => {
  for (const port of ["1024", "65535"]) {
    assert.ok(
      browserCommands({ OPENAPPLY_BROWSER_CDP_PORT: port }).launch.includes(
        `http://127.0.0.1:${port}`,
      ),
    );
  }
  for (const port of [
    "",
    "1023",
    "65536",
    "-19222",
    "19222.1",
    "19e3",
    " 19222",
    "19222 ",
    "19222;echo bad",
    "19222$(whoami)",
    "127.0.0.1:19222",
    19222,
  ]) {
    assert.throws(
      () => browserCommands({ OPENAPPLY_BROWSER_CDP_PORT: port }),
      /OPENAPPLY_BROWSER_CDP_PORT/,
    );
  }
});

test("browser output paths reject traversal, outside paths, shell syntax, and option injection", () => {
  for (const outputDir of [
    "",
    "/tmp/fixture",
    "relative/path",
    "C:\\home\\pilot\\openapply",
    "/home/pilot/openapply-other",
    "/home/pilot/openapply/../outside",
    "/home/pilot/openapply/a/../../outside",
    "/home/pilot/openapply/./fixture",
    "/home/pilot/openapply//fixture",
    "/home/pilot/openapply/fixture/",
    "/home/pilot/openapply/fixture name",
    "/home/pilot/openapply/fixture;touch",
    "/home/pilot/openapply/$(whoami)",
    "/home/pilot/openapply/`whoami`",
    "/home/pilot/openapply/'fixture'",
    '/home/pilot/openapply/"fixture"',
    "/home/pilot/openapply/fixture\nwhoami",
    "/home/pilot/openapply/fixture&whoami",
    "--output-dir=/tmp",
    123,
  ]) {
    assert.throws(
      () => browserCommands({ OPENAPPLY_BROWSER_OUTPUT_DIR: outputDir }),
      /OPENAPPLY_BROWSER_OUTPUT_DIR/,
      String(outputDir),
    );
  }
});

test("safe punctuation remains literal in separate arguments without shell quoting", () => {
  const outputDir = "/home/pilot/openapply/.temp/run_1.2-3/-browser";
  const commands = browserCommands({ OPENAPPLY_BROWSER_OUTPUT_DIR: outputDir });
  for (const command of commands.prepare) assert.equal(command.at(-1), outputDir);
  assert.equal(commands.launch.at(-1), outputDir);
  assert.equal(commands.launch[4], outputDir);
  assert.equal(commands.launch[2], browserCommands({}).launch[2]);
});
