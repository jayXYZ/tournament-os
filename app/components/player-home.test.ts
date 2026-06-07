import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./player-home.tsx", import.meta.url),
  "utf8",
);

test("PlayerHome composes root page UI from installed shadcn primitives", () => {
  assert.match(source, /from "@\/components\/ui\/card"/);
  assert.match(source, /from "@\/components\/ui\/empty"/);
  assert.match(source, /from "@\/components\/ui\/separator"/);
  assert.match(source, /from "@\/components\/ui\/skeleton"/);
  assert.match(source, /from "@\/components\/ui\/spinner"/);
  assert.match(source, /from "@\/components\/ui\/table"/);

  assert.match(source, /<Card[\s>]/);
  assert.match(source, /<Empty[\s>]/);
  assert.match(source, /<Separator[\s/>]/);
  assert.match(source, /<Skeleton[\s/>]/);
  assert.match(source, /<Spinner[\s/>]/);
  assert.match(source, /<Table[\s>]/);

  assert.doesNotMatch(source, /<table[\s>]/);
  assert.doesNotMatch(source, /animate-pulse/);
  assert.doesNotMatch(source, /Create account/);
});
