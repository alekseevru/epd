import assert from "node:assert/strict";
import test from "node:test";
import { isTmsApiConfigured, resolveTmsCredentials } from "../tms-credentials.mjs";

const environment = { TMS_LOGIN: "Taglex_api", TMS_PASSWORD: "server-only-test-secret" };

test("server API account is used by default without browser credentials", () => {
  assert.equal(isTmsApiConfigured(environment), true);
  assert.deepEqual(resolveTmsCredentials({ mode: "api", login: "ignored", password: "ignored" }, environment), {
    login: "Taglex_api", password: "server-only-test-secret", captcha: "",
  });
});

test("personal fallback uses only credentials explicitly submitted by the user", () => {
  assert.deepEqual(resolveTmsCredentials({ mode: "personal", login: " employee ", password: "personal-test-secret", captcha: " 1234 " }, environment), {
    login: "employee", password: "personal-test-secret", captcha: "1234",
  });
});

test("missing API configuration requires the personal fallback", () => {
  assert.equal(isTmsApiConfigured({ TMS_LOGIN: "Taglex_api", TMS_PASSWORD: "" }), false);
  assert.throws(() => resolveTmsCredentials({ mode: "api" }, {}), /не настроена/);
  assert.throws(() => resolveTmsCredentials({ mode: "personal", login: "employee" }, environment), /логин и пароль/);
  assert.throws(() => resolveTmsCredentials({ mode: "other" }, environment), /Неизвестный способ/);
});
