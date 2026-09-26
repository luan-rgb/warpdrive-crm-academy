import { describe, expect, it } from "vitest";
import { dealFilterFields } from "./dealFilterCatalog";
import { describeRows } from "./describeFilter";

const FIELDS = dealFilterFields({
  owners: [{ id: "u1", name: "Ada King" }],
  stages: [{ id: "s1", name: "Qualified" }],
  labelOptions: ["Hot"],
});

describe("describeRows", () => {
  it("names a text condition with the field label and the operator label", () => {
    expect(describeRows([{ field: "title", op: "contains", value: "Acme" }], FIELDS)).toBe(
      "Título contém Acme",
    );
  });

  it("resolves an owner id to the owner's name", () => {
    expect(describeRows([{ field: "ownerId", op: "eq", value: "u1" }], FIELDS)).toBe(
      "Responsável é Ada King",
    );
  });

  it("resolves a stage id and a label value to their names", () => {
    expect(
      describeRows(
        [
          { field: "stageId", op: "eq", value: "s1" },
          { field: "labels", op: "neq", value: "Hot" },
        ],
        FIELDS,
      ),
    ).toBe("Etapa é Qualified e Etiqueta não é Hot");
  });

  it("skips rows with no value and returns an empty string when nothing is set", () => {
    expect(describeRows([{ field: "title", op: "contains", value: "  " }], FIELDS)).toBe("");
  });

  it("renders a valueless condition with no trailing value", () => {
    expect(describeRows([{ field: "value", op: "isEmpty", value: "" }], FIELDS)).toBe(
      "Valor está vazio",
    );
    expect(
      describeRows(
        [
          { field: "title", op: "isNotEmpty", value: "" },
          { field: "value", op: "gt", value: "60000" },
        ],
        FIELDS,
      ),
    ).toBe("Título não está vazio e Valor maior que 60000");
  });

  // "Label is Hot,Cold" reads as one label named "Hot,Cold"; the condition means either one.
  it("reads a multi-label condition as a list of alternatives", () => {
    expect(describeRows([{ field: "labels", op: "eq", value: ["Hot", "Cold"] }], FIELDS)).toBe(
      "Etiqueta é Hot ou Cold",
    );
  });

  it("joins the conditions with the combinator the user picked", () => {
    expect(
      describeRows(
        [
          { field: "title", op: "contains", value: "Acme" },
          { field: "value", op: "gt", value: "60000" },
        ],
        FIELDS,
        "or",
      ),
    ).toBe("Título contém Acme ou Valor maior que 60000");
  });

  it("skips a multi-value row with nothing picked", () => {
    expect(describeRows([{ field: "labels", op: "eq", value: [] }], FIELDS)).toBe("");
  });

  it("falls back to the raw value when the id matches no option", () => {
    expect(describeRows([{ field: "ownerId", op: "eq", value: "u9" }], FIELDS)).toBe("Responsável é u9");
  });
});
