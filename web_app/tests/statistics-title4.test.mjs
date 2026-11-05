import test from "node:test";
import assert from "node:assert/strict";
import {isCarrierTitle4Signed} from "../statistics-title4.mjs";

test("counts only the signed fourth title", () => {
  assert.equal(isCarrierTitle4Signed({Docflow:{Titles:[
    {TitleIndex:2,AuthorSigning:{IsFinished:true}},
    {TitleIndex:3,AuthorSigning:{IsFinished:false}},
  ]}}),false);
  assert.equal(isCarrierTitle4Signed({Docflow:{Titles:[
    {TitleIndex:2,AuthorSigning:{IsFinished:true}},
    {TitleIndex:3,AuthorSigning:{IsFinished:true}},
  ]}}),true);
  assert.equal(isCarrierTitle4Signed(null),false);
});
