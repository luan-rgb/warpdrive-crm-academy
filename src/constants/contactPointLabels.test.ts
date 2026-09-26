import { describe, expect, it } from "vitest";
import { contactPointLabel } from "./contactPointLabels";

describe("contactPointLabel", () => {
  it("shows stored phone/email types in Portuguese and passes unknown ones through", () => {
    expect(contactPointLabel("Work")).toBe("Trabalho");
    expect(contactPointLabel("Mobile")).toBe("Celular");
    expect(contactPointLabel("Fax")).toBe("Fax");
  });
});
