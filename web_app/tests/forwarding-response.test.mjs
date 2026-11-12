import test from "node:test";
import assert from "node:assert/strict";
import {readForwardingResponse} from "../app/forwarding-response.ts";

test("forwarding generation reports maintenance response without parsing HTML", async () => {
  const response = new Response("<!DOCTYPE html><title>Технические работы</title>", {status:503,headers:{"content-type":"text/html"}});
  await assert.rejects(readForwardingResponse(response), /Сервис временно недоступен \(503\)/);
});

test("forwarding generation reports an unexpected HTML page", async () => {
  const response = new Response("<!DOCTYPE html>", {status:200,headers:{"content-type":"text/html"}});
  await assert.rejects(readForwardingResponse(response), /Сервер вернул страницу вместо ответа/);
});

test("forwarding generation keeps the JSON confirmation response", async () => {
  const response = Response.json({requiresConfirmation:true,warnings:["Укажите дату"]});
  assert.deepEqual(await readForwardingResponse(response), {requiresConfirmation:true,warnings:["Укажите дату"]});
});
