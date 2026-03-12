import { getFailureReason } from "./utils";

export const TX_SEND_ERROR_CODES = {
  refused: 1,
  failure: 2,
};

export function createTxSendError(
  code: keyof typeof TX_SEND_ERROR_CODES,
  cause?: unknown,
) {
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

export function createApiError(
  code: keyof typeof API_ERROR_CODES,
  cause?: unknown,
) {
  return {
    code: API_ERROR_CODES[code],
    info: getFailureReason(cause) ?? "unknown",
  };
}

export const TX_SIGN_ERROR_CODES = {
  proofGeneration: 1,
  userDeclined: 2,
};

export type TxSignErrorCode = keyof typeof TX_SIGN_ERROR_CODES;

export function createTxSignError(code: TxSignErrorCode, cause?: unknown) {
  let info = getFailureReason(cause) ?? "unknown";
  for (const prefix of ["ProofGeneration: ", "UserDeclined: "]) {
    if (info.startsWith(prefix)) {
      info = info.slice(prefix.length);
      break;
    }
  }
  if (info === "UserDeclined") {
    info = "User declined";
  }
  if (info === "ProofGeneration") {
    info = "Unable to sign the transaction";
  }
  return {
    code: TX_SIGN_ERROR_CODES[code],
    info,
  };
}
