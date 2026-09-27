import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db/client";
import { updateActivity } from "@/features/activities/activityUpdate";
import { completeActivity, createActivity } from "@/features/activities/repo";
import { activityCreateInput, activityUpdateInput } from "@/features/activities/schemas";
import { triggerActivityAutomations } from "@/features/automations/activityTriggers";
import { createNote } from "@/features/collaboration/notesRepo";
import { noteCreateInput } from "@/features/collaboration/notesSchemas";
import { toAuthUser, toPermSetUser } from "@/features/mcp/actorContext";
import {
  type GetCtx,
  getToolActor,
  registerTool,
  requireFlag,
  resultToTool,
  type ToolRegistry,
  toolError,
} from "./types";

const completeActivityInput = z.object({ id: z.string().uuid(), done: z.boolean() });

export function registerActivityWriteTools(
  server: McpServer,
  registry: ToolRegistry,
  getCtx: GetCtx,
  db: Db,
): void {
  registerTool(server, registry, {
    name: "create_activity",
    description: "Create an activity",
    inputSchema: activityCreateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const denied = requireFlag(actor.value, "activity.create");
      if (denied !== null) return denied;
      const created = await createActivity(db, toPermSetUser(actor.value), input, signal);
      if (created.ok)
        await triggerActivityAutomations(db, created.value, "activity_created", signal);
      return resultToTool(created);
    },
  });
  registerTool(server, registry, {
    name: "update_activity",
    description: "Update an activity",
    inputSchema: activityUpdateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      return resultToTool(await updateActivity(db, toPermSetUser(actor.value), input, signal));
    },
  });
  registerTool(server, registry, {
    name: "complete_activity",
    description: "Set an activity completion state",
    inputSchema: completeActivityInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const done = await completeActivity(
        db,
        toPermSetUser(actor.value),
        input.id,
        input.done,
        signal,
      );
      if (done.ok && input.done) {
        await triggerActivityAutomations(db, done.value, "activity_completed", signal);
      }
      return resultToTool(done);
    },
  });
  registerTool(server, registry, {
    name: "add_note",
    description: "Add a note to a CRM record",
    inputSchema: noteCreateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      return resultToTool(await createNote(db, toAuthUser(actor.value), input, signal));
    },
  });
}
