// SMTP delivers exactly the bytes it is given, so a Bcc header left in the MIME (buildMime writes
// one, as the Gmail API expects) would reveal the blind copies to every recipient. Gmail and Graph
// strip it server-side; for raw SMTP we strip it ourselves, header block only.
export function stripBccHeader(mime: Buffer): Buffer {
  const text = mime.toString("utf8");
  const split = text.search(/\r?\n\r?\n/);
  const head = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split);
  const lines = head.split(/\r?\n/);
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const continuation = /^[ \t]/.test(line);
    if (!continuation) dropping = /^bcc:/i.test(line);
    if (!dropping) kept.push(line);
  }
  if (kept.length === lines.length) return mime;
  return Buffer.from(kept.join("\r\n") + body, "utf8");
}
