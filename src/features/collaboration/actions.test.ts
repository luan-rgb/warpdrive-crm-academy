import { expect, it, vi } from "vitest";

vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: false as const }),
}));

import { deleteNoteAction, updateNoteAction } from "./actions";

it("updateNoteAction rejects a bad CSRF token", async () => {
  const r = await updateNoteAction({ noteId: "n1", body: "x" }, null);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.id).toBe("E_AUTH_CSRF");
});

it("deleteNoteAction rejects a bad CSRF token", async () => {
  const r = await deleteNoteAction({ noteId: "n1" }, null);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.id).toBe("E_AUTH_CSRF");
});

it("togglePinAction refuses malformed input after CSRF passes", async () => {
  vi.resetModules();
  vi.doMock("@/features/identity/actions/shared", () => ({
    guardCsrf: () => Promise.resolve({ ok: true as const }),
  }));
  vi.doMock("@/db/client", () => ({ db: {} }));
  vi.doMock("@/server/trpc/context", () => ({
    createContext: () => Promise.resolve({ actor: { id: "u1" }, session: null, db: {} }),
  }));
  const togglePin = vi.fn();
  vi.doMock("./notesRepo", () => ({ togglePin, updateNote: vi.fn(), softDeleteNote: vi.fn() }));
  const { togglePinAction } = await import("./actions");
  const r = await togglePinAction({ noteId: "x", pinned: 1 } as unknown as {
    noteId: string;
    pinned: boolean;
  });
  expect(r).toEqual({ ok: false, error: { id: "E_NOTE_003" } });
  expect(togglePin).not.toHaveBeenCalled();
});
