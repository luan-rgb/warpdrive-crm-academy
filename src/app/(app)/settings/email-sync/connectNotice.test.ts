import { describe, expect, it } from "vitest";
import { parseConnectNotice } from "./connectNotice";

describe("parseConnectNotice", () => {
  it("reads the relay's success and error return parameters", () => {
    expect(parseConnectNotice({ connected: "gmail" })).toEqual({
      kind: "connected",
      code: "gmail",
    });
    expect(parseConnectNotice({ connect_error: "taken" })).toEqual({
      kind: "error",
      code: "taken",
    });
  });

  it("ignores anything else, including unexpected values", () => {
    expect(parseConnectNotice({})).toBeNull();
    expect(parseConnectNotice({ connected: "evil<script>" })).toBeNull();
    expect(parseConnectNotice({ connected: ["gmail", "outlook"] })).toBeNull();
  });
});
