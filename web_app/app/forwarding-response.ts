export type ForwardingResponse = {
  requiresConfirmation?: boolean;
  warnings?: string[];
  editableFields?: {id:string;label:string;inputType?:"date"}[];
  content?: string;
  filename?: string;
  recipientBoxId?: string;
  error?: string;
};

export async function readForwardingResponse(response: Response): Promise<ForwardingResponse> {
  if (response.status === 503) {
    throw new Error("Сервис временно недоступен (503). Поручение не сформировано. Повторите попытку после восстановления сервиса.");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`Сервер вернул страницу вместо ответа о формировании поручения (HTTP ${response.status}). Поручение не сформировано; повторите попытку позже.`);
  }
  try {
    return await response.json() as ForwardingResponse;
  } catch {
    throw new Error(`Не удалось прочитать ответ сервера о формировании поручения (HTTP ${response.status}). Повторите попытку позже.`);
  }
}
