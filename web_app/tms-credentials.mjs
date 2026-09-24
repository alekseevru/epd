export function isTmsApiConfigured(environment = process.env) {
  return Boolean(String(environment.TMS_LOGIN || "").trim() && environment.TMS_PASSWORD);
}

export function resolveTmsCredentials(supplied = {}, environment = process.env) {
  if (supplied.mode === "personal") {
    const login = typeof supplied.login === "string" ? supplied.login.trim() : "";
    const password = typeof supplied.password === "string" ? supplied.password : "";
    const captcha = typeof supplied.captcha === "string" ? supplied.captcha.trim() : "";
    if (!login || !password) throw new Error("Укажите свой логин и пароль TMS");
    return { login, password, captcha };
  }
  if (supplied.mode && supplied.mode !== "api") throw new Error("Неизвестный способ входа в TMS");
  if (!isTmsApiConfigured(environment)) throw new Error("API-учётная запись TMS не настроена на сервере. Введите свой логин и пароль.");
  return { login: String(environment.TMS_LOGIN).trim(), password: environment.TMS_PASSWORD, captcha: "" };
}
