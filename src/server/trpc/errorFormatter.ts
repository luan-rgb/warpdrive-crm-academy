import { ERROR_IDS } from "@/constants/errorIds";

// Our own errors carry a registry id (E_<DOMAIN>_<NNN>) as the message; the UI maps it to copy.
const APP_ERROR_ID = /^E_[A-Z]+_\d{3}$/;

interface Shape {
  message: string;
  data: { code: string; stack?: string } & Record<string, unknown>;
}

// tRPC copies an unexpected exception's message into the response. For a failed query that is
// the SQL text plus every bound value (emails, names), so anything that is not one of our ids is
// replaced by a generic id; the full error still reaches onError and the server log.
export function redactErrorShape<S extends Shape>(shape: S): S {
  if (shape.data.code !== "INTERNAL_SERVER_ERROR" || APP_ERROR_ID.test(shape.message)) {
    return shape;
  }
  const data = { ...shape.data };
  delete data.stack;
  return { ...shape, message: ERROR_IDS.INTERNAL_UNEXPECTED, data };
}
