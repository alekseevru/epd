import test from "node:test";
import assert from "node:assert/strict";
import { isGeneratorStartupMessage } from "../generator-worker-protocol.mjs";

test("startup notification is ignored", () => {
  assert.equal(isGeneratorStartupMessage({ready:true,error:null}), true);
});

test("request response is delivered even if it contains ready", () => {
  assert.equal(isGeneratorStartupMessage({ready:true,requestId:7}), false);
  assert.equal(isGeneratorStartupMessage({departureChecked:true,requestId:7}), false);
});
