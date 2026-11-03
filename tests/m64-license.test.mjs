import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("repository MIT license has complete grant and Mushee copyright",()=>{
  const license=readFileSync(new URL("../LICENSE",import.meta.url),"utf8");
  assert.match(license,/^MIT License\n/);
  assert.match(license,/Copyright \(c\) 2026 Mushee/);
  assert.match(license,/Permission is hereby granted, free of charge/);
  assert.match(license,/copies or substantial portions of the Software/);
  assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
});
