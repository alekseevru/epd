import assert from "node:assert/strict";
import test from "node:test";
import { activeForwardingDrafts, containsContainer } from "./kontur-document-presence.mjs";

const event = (id, number, {recycled=false, type="LogisticsForwardingOrder"}={}) => ({
  DocumentId:{MessageId:id,EntityId:`entity-${id}`},
  Document:{DocumentInfo:{MessageType:"Draft",FullVersion:{TypeNamedId:type},IsDeleted:false,
    DraftInfo:{IsRecycled:recycled},Metadata:[{Key:"DocumentNumber",Value:number}]}}
});

test("active forwarding draft matches the exact container", () => {
  const drafts=activeForwardingDrafts([event("active","FESU5214204")]);
  assert.equal(drafts.length,1);
  assert.equal(drafts[0].number,"FESU5214204");
  assert.equal(containsContainer(drafts[0].number,"FESU5214204"),true);
  assert.equal(containsContainer(drafts[0].number,"FESU5214205"),false);
});

test("recycled draft is not reported from an older active event", () => {
  assert.deepEqual(activeForwardingDrafts([event("same","FESU5214204",{recycled:true}),event("same","FESU5214204")]),[]);
});

test("multiple containers in one active forwarding order are matched", () => {
  const [draft]=activeForwardingDrafts([event("multi","FESU5214204, TEMU7742835")]);
  assert.equal(containsContainer(draft.number,"TEMU7742835"),true);
  assert.equal(activeForwardingDrafts([event("other","FESU5214204",{type:"LogisticsWaybill"})]).length,0);
});
