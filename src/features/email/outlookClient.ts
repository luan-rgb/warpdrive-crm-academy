import { AppError } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import type { MessageList } from "./gmailSchemas";
import { folderLabel, type OutlookFolderIds, toGmailMessageShape } from "./outlookMessageMap";
import {
  graphAttachmentSchema,
  graphDraftSchema,
  graphFolderSchema,
  graphMessageListSchema,
  graphMessageSchema,
} from "./outlookSchemas";

const GRAPH = "https://graph.microsoft.com/v1.0/me";
const PAGE_SIZE = 50;
const MESSAGE_SELECT =
  "id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,sentDateTime,receivedDateTime,internetMessageId,parentFolderId";

interface Schema<T> {
  parse: (u: unknown) => T;
}

// OData query string. Not URLSearchParams: that encodes "$" in the system query option names and
// spaces as "+", which Graph does not reliably read inside $filter.
function odataQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// OData string literal: single quotes are escaped by doubling.
function odataString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

// Outlook via Microsoft Graph, behind the same GmailClient interface as Gmail so sync, send,
// trash and attachments need no provider branches. Two Graph details shape it:
// - Prefer: IdType="ImmutableId" keeps a message id stable when it moves folders (sent, trashed),
//   which the (account_id, gmail_message_id) dedupe key depends on.
// - Graph has no history cursor, so this account syncs through the polled path (syncPolledMailbox):
//   historyList/getProfile are inert and listMessages returns the most recent messages.
export function createOutlookClient(accessToken: string): GmailClient {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Prefer: 'IdType="ImmutableId"',
  } as const;

  async function graph<T>(
    url: string,
    init: RequestInit,
    schema: Schema<T>,
    signal: AbortSignal,
  ): Promise<Result<T, AppError>> {
    const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal });
    signal.throwIfAborted();
    if (!res.ok) {
      const graphError = await res
        .json()
        .then((b: unknown) => (b as { error?: { message?: string } }).error?.message ?? null)
        .catch(() => null);
      return err(
        new AppError("E_MAIL_003", "graph call failed", {
          status: res.status,
          statusText: res.statusText,
          oauthError: graphError,
        }),
      );
    }
    const body: unknown = res.status === 202 || res.status === 204 ? {} : await res.json();
    signal.throwIfAborted();
    try {
      return ok(schema.parse(body));
    } catch {
      return err(new AppError("E_MAIL_003", "graph response failed schema validation", {}));
    }
  }

  let folders: Promise<Result<OutlookFolderIds, AppError>> | null = null;
  function folderIds(signal: AbortSignal): Promise<Result<OutlookFolderIds, AppError>> {
    folders ??= (async () => {
      const folder = (name: string) =>
        graph(`${GRAPH}/mailFolders/${name}?$select=id`, {}, graphFolderSchema, signal);
      const [trash, spam, sent] = await Promise.all([
        folder("deleteditems"),
        folder("junkemail"),
        folder("sentitems"),
      ]);
      if (!trash.ok) return trash;
      if (!spam.ok) return spam;
      if (!sent.ok) return sent;
      return ok({ trash: trash.value.id, spam: spam.value.id, sent: sent.value.id });
    })();
    return folders.then((r) => {
      if (!r.ok) folders = null; // do not cache a transient failure
      return r;
    });
  }

  function listUrl(filter: string, top = PAGE_SIZE): string {
    const p = odataQuery({
      $select: "id,conversationId,parentFolderId",
      $filter: filter,
      $top: String(top),
    });
    return `${GRAPH}/messages?${p}`;
  }

  async function listIds(url: string, signal: AbortSignal): Promise<Result<MessageList, AppError>> {
    const r = await graph(url, {}, graphMessageListSchema, signal);
    if (!r.ok) return r;
    return ok({
      messages: r.value.value.map((m) => ({ id: m.id, threadId: m.conversationId })),
      nextPageToken: r.value["@odata.nextLink"],
    });
  }

  async function conversation(conversationId: string, signal: AbortSignal) {
    return graph(
      listUrl(`conversationId eq ${odataString(conversationId)}`),
      {},
      graphMessageListSchema,
      signal,
    );
  }

  return {
    historyList({ startHistoryId, signal }) {
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: startHistoryId, history: [] }));
    },

    getProfile({ signal }) {
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: "0" }));
    },

    async getMessage({ id, signal }) {
      const f = await folderIds(signal);
      if (!f.ok) return f;
      const p = odataQuery({
        $select: MESSAGE_SELECT,
        $expand: "attachments($select=id,name,contentType,size,isInline)",
      });
      const r = await graph(
        `${GRAPH}/messages/${encodeURIComponent(id)}?${p}`,
        {},
        graphMessageSchema,
        signal,
      );
      if (!r.ok) return r;
      return ok(toGmailMessageShape(r.value, f.value));
    },

    async getThread({ id, signal }) {
      const f = await folderIds(signal);
      if (!f.ok) return f;
      const r = await conversation(id, signal);
      if (!r.ok) return r;
      return ok({
        id,
        messages: r.value.value.map((m) => ({
          id: m.id,
          labelIds: [folderLabel(m.parentFolderId, f.value)],
        })),
      });
    },

    // Graph accepts a full MIME message as a draft (base64 body, text/plain). Creating the draft
    // first, instead of /sendMail, gives back an immutable id that survives the move to Sent
    // Items, so the CRM's outbound copy and the later synced copy dedupe on the same id.
    async sendRaw({ rawBase64, signal }) {
      const mime = Buffer.from(rawBase64, "base64url").toString("base64");
      const draft = await graph(
        `${GRAPH}/messages`,
        { method: "POST", headers: { "content-type": "text/plain" }, body: mime },
        graphDraftSchema,
        signal,
      );
      if (!draft.ok) return draft;
      const sent = await graph(
        `${GRAPH}/messages/${encodeURIComponent(draft.value.id)}/send`,
        { method: "POST" },
        { parse: () => null },
        signal,
      );
      if (!sent.ok) {
        // The draft exists but the send itself failed: never report it as a clean 4xx, since a
        // blind resend could duplicate a message Exchange accepted. Let the outbox reconcile.
        return err(
          new AppError("E_MAIL_003", "graph send failed after draft", {
            status: 500,
            sendStatus: sent.error.context?.status,
          }),
        );
      }
      return ok({ id: draft.value.id, threadId: draft.value.conversationId });
    },

    searchByRfc822({ messageIdHeader, signal }) {
      return listIds(listUrl(`internetMessageId eq ${odataString(messageIdHeader)}`, 5), signal);
    },

    async getAttachment({ messageId, attachmentId, signal }) {
      const r = await graph(
        `${GRAPH}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {},
        graphAttachmentSchema,
        signal,
      );
      if (!r.ok) return r;
      return ok({ dataBase64: Buffer.from(r.value.contentBytes, "base64").toString("base64url") });
    },

    // pageToken is Graph's own @odata.nextLink (a full URL), handed back verbatim. q is
    // Gmail search syntax and has no Graph equivalent; the spam sweep's includeSpamTrash maps
    // to listing the Junk folder.
    listMessages({ pageToken, includeSpamTrash, signal }) {
      if (pageToken !== undefined) return listIds(pageToken, signal);
      if (includeSpamTrash === true) {
        const p = odataQuery({ $select: "id,conversationId", $top: String(PAGE_SIZE) });
        return listIds(`${GRAPH}/mailFolders/junkemail/messages?${p}`, signal);
      }
      const p = odataQuery({
        $select: "id,conversationId",
        $filter: "receivedDateTime ge 1900-01-01T00:00:00Z and isDraft eq false",
        $orderby: "receivedDateTime desc",
        $top: String(PAGE_SIZE),
      });
      return listIds(`${GRAPH}/messages?${p}`, signal);
    },

    async trashThread({ threadId, signal }) {
      const r = await conversation(threadId, signal);
      if (!r.ok) return r;
      for (const m of r.value.value) {
        const moved = await graph(
          `${GRAPH}/messages/${encodeURIComponent(m.id)}/move`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ destinationId: "deleteditems" }),
          },
          { parse: () => null },
          signal,
        );
        if (!moved.ok) return moved;
      }
      return ok({ id: threadId });
    },
  };
}
