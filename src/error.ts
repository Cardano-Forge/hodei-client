import { getFailureReason } from "./utils";

export const TX_SEND_ERROR_CODES = {
  refused: 1,
  failure: 2,
};

export function createTxSendError(code: keyof typeof TX_SEND_ERROR_CODES, cause?: unknown) {
  return {
    code: TX_SEND_ERROR_CODES[code],
    info: getFailureReason(cause) ?? "unknown",
  };
}

export const API_ERROR_CODES = {
  invalidRequest: -1,
  internalError: -2,
  refused: -3,
  accountChange: -4,
};

export function createApiError(code: keyof typeof API_ERROR_CODES, cause?: unknown) {
  return {
    code: API_ERROR_CODES[code],
    info: getFailureReason(cause) ?? "unknown",
  };
}
