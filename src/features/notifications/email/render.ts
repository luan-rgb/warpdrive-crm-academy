import { env } from "@/config/env";
import { entityHref } from "@/features/notifications/entityHref";
import type { NotificationRow } from "@/types/notification";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

function wrap(line: string, link: string): { text: string; html: string } {
  const text = `${line}\n\nAbrir: ${link}`;
  const html = `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(link)}">Abrir no Warpdrive</a></p>`;
  return { text, html };
}

// Per-type copy strings. No em dashes; no magic strings duplicated.
export function renderNotificationEmail(
  row: NotificationRow,
  recipientName: string,
): { subject: string; text: string; html: string } {
  const base = env.BASE_URL;
  // Never derive the path from the entity type: pluralizing it produced /activitys/<id>,
  // /persons/<id> and /organizations/<id>, none of which are routes in this app.
  const path = entityHref(row.entityType, row.entityId);
  const link = path !== null ? `${base}${path}` : base;

  let subject: string;
  let line: string;

  switch (row.type) {
    case "mention":
      subject = "Alguém mencionou você no Warpdrive";
      line = `${recipientName}, alguém mencionou você.`;
      break;
    case "activity_assigned":
      subject = "Uma atividade foi atribuída a você no Warpdrive";
      line = `${recipientName}, uma atividade foi atribuída a você.`;
      break;
    case "activity_reminder": {
      const activitySubject =
        typeof row.payload.subject === "string" ? row.payload.subject : "atividade";
      subject = `Lembrete: ${activitySubject} vence em breve`;
      line = `${recipientName}, sua atividade "${activitySubject}" vence em breve.`;
      break;
    }
    case "deal_followed_update":
      subject = "Um negócio que você segue teve uma atualização";
      line = `${recipientName}, um negócio que você segue foi atualizado.`;
      break;
    case "email_open":
      subject = "Seu email foi aberto";
      line = `${recipientName}, alguém abriu seu email.`;
      break;
    case "email_click":
      subject = "Um link no seu email foi clicado";
      line = `${recipientName}, alguém clicou em um link no seu email.`;
      break;
    case "deal_won":
      subject = "Negócio ganho!";
      line = `${recipientName}, um negócio foi marcado como ganho.`;
      break;
    case "deal_lost":
      subject = "Negócio perdido";
      line = `${recipientName}, um negócio foi marcado como perdido.`;
      break;
    case "comment_reply":
      subject = "Alguém respondeu ao seu comentário no Warpdrive";
      line = `${recipientName}, alguém respondeu ao seu comentário.`;
      break;
    case "automation":
      subject = "Automação executada";
      line = `${recipientName}, uma regra de automação rodou em um negócio.`;
      break;
    case "deal_email_received": {
      const emailSubject = typeof row.payload.subject === "string" ? row.payload.subject : null;
      subject =
        emailSubject !== null
          ? `Novo email em um negócio: ${emailSubject}`
          : "Novo email em um negócio";
      line = `${recipientName}, um novo email chegou em um negócio que você segue.`;
      break;
    }
    default: {
      // Unknown future type: render a generic fallback. Never throw (pg-boss resilience).
      subject = "Notificação do Warpdrive";
      line = `${recipientName}, você tem uma nova notificação.`;
    }
  }

  const { text, html } = wrap(line, link);
  return { subject, text, html };
}
