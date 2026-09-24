import assert from "node:assert/strict";
import test from "node:test";
import { generateTmsCaptcha, syncTms, TmsCaptchaError, TmsSessionConflictError } from "../tms-sync.mjs";

test("TMS captcha request returns its SVG image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/api\/captcha\/generate$/);
    assert.equal(new URLSearchParams(options.body).get("login"), "employee");
    return Response.json({ result: { data: { captchaImage: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } } });
  };
  try {
    assert.match(await generateTmsCaptcha("employee"), /^<svg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TMS login sends captcha and preserves a new challenge for retry", async () => {
  const originalFetch = globalThis.fetch;
  const loginBodies = [];
  globalThis.fetch = async (url, options) => {
    if (!options?.method) return new Response("", { status: 200 });
    assert.match(String(url), /\/login$/);
    loginBodies.push(new URLSearchParams(options.body));
    return Response.json({ type: "error", code: "Неправильно введены символы капчи", data: { captchaImage: "<svg></svg>" } });
  };
  try {
    await assert.rejects(
      syncTms({ login: "employee", password: "secret", captcha: "1234", cacheDir: "unused", referenceDir: "unused" }),
      error => error instanceof TmsCaptchaError && error.image === "<svg></svg>",
    );
    assert.equal(loginBodies.length, 1);
    assert.equal(loginBodies[0].get("captcha"), "1234");
    assert.equal(loginBodies[0].get("login"), "employee");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TMS active session shows a useful message without kicking the user", async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [];
  globalThis.fetch = async (url, options) => {
    if (!options?.method) return new Response("", { status: 200 });
    assert.match(String(url), /\/login$/);
    assert.equal(new URLSearchParams(options.body).has("kickAnother"), false);
    return Response.json({ type: "error", code: "exists_another_devices" });
  };
  try {
    await assert.rejects(
      syncTms({ login: "employee", password: "secret", cacheDir: "unused", referenceDir: "unused", onStatus: (...status) => statuses.push(status) }),
      error => error instanceof TmsSessionConflictError && /Выйдите из TMS/.test(error.message),
    );
    assert.match(statuses.find(([key, state]) => key === "login" && state === "error")?.[2] || "", /другой сессии/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
