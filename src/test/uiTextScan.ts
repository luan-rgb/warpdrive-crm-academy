// Extracts user-visible text from the app's source with the TypeScript compiler (no regex guessing
// over JSX) and flags strings that read as English. Used by ptBrAudit.test.ts, the guard for the
// "the whole UI is in Brazilian Portuguese" requirement.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface UiText {
  file: string;
  line: number;
  text: string;
}

// JSX attributes and object keys whose string values end up on screen (or in an email).
const VISIBLE_ATTRS = new Set([
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "title",
  "alt",
  "label",
  "description",
  "emptyText",
  "emptyLabel",
  "emptyMessage",
  "hint",
  "tooltip",
  "message",
  "heading",
  "subtitle",
  "confirmLabel",
  "cancelLabel",
  "submitLabel",
  "ariaLabel",
  "triggerTitle",
]);

// Words that only appear in English UI copy. Deliberately excludes words Portuguese shares or that
// the Portuguese UI keeps as loanwords (email, status, lead, pipeline, dashboard, a, no, as, do...).
const ENGLISH_WORDS = new Set(
  (
    "the and or of to add save cancel delete edit new search select none yes all show hide more less " +
    "close open create update remove name phone owner title value stage deal deals person people " +
    "organization organizations activity activities note notes file files settings loading error failed " +
    "could not please try again back next previous today yesterday tomorrow week month year day days " +
    "hours minutes ago work mobile home other label labels filter filters columns clear apply custom " +
    "color collapse expand mark read unread upload download count unauthorized forbidden found page " +
    "your you this that is are was will can by with selected match matches empty unknown date time " +
    "enter such join call remote content drafts saved scheduled no-date allow deny request connection " +
    "application access revoke later anyone reports verified start end source origin expected actions " +
    "unavailable could't couldn't run type contact primary similar already has have undo redo done " +
    "condition field operator more remove required invalid missing optional anyone reload " +
    "list calendar board archive archived inbox sort view export import send reply forward " +
    "trash help overview summary details history timeline notification notifications profile " +
    "team teams user users goal goals product products template templates signature " +
    "signatures sign log logout login password submit confirm continue finish previous"
  ).split(" "),
);

function englishHits(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.filter((w) => ENGLISH_WORDS.has(w));
}

// A string is flagged when it has English UI words and no Portuguese-only characters/words that
// would show it is already translated.
export function looksEnglish(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || !/[a-zA-Z]/.test(t)) return false;
  if (/[áàâãéêíóôõúç]/i.test(t)) return false;
  if (/\b(de|da|do|das|dos|para|com|não|uma|um|em|ao|os|que|seu|sua|sem|por)\b/i.test(t))
    return false;
  // Identifiers, keys, CSS, URLs, MIME types and similar machine strings.
  if (/^[\w.:/@#-]+$/.test(t) && !/\s/.test(t) && !/^[A-Z][a-z]+$/.test(t)) return false;
  return englishHits(t).length > 0;
}

// Calls whose string arguments never reach a user: internal error messages, logs, SQL, test ids.
const INTERNAL_CALLS = new Set([
  "AppError",
  "Error",
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "sql",
  "raw",
  "require",
  "import",
  "startsWith",
  "endsWith",
  "includes",
  "replace",
  "replaceAll",
  "split",
  "join",
  "get",
  "set",
  "has",
  "getItem",
  "setItem",
  "querySelector",
  "addEventListener",
  "removeEventListener",
  "matchMedia",
  "cn",
  "cva",
  "clsx",
  "useQueryState",
]);

// Tailwind class strings ("rounded p-1 hover:bg-accent") are not copy.
function looksLikeClassList(text: string): boolean {
  const tokens = text.trim().split(/\s+/);
  const classy = tokens.filter((t) =>
    /[-:[\]/]|^(flex|grid|block|hidden|truncate|relative|absolute|group|border|rounded|underline|italic)$/.test(
      t,
    ),
  );
  return tokens.length > 1 && classy.length * 2 >= tokens.length;
}

// Positions where a literal is never copy: imports, types, object keys, switch cases, index keys,
// equality operands, tagged templates and JSX attributes the visible-attribute rule did not pick.
function isStructuralPosition(node: ts.Node, sf: ts.SourceFile): boolean {
  const p = node.parent;
  return (
    ts.isImportDeclaration(p) ||
    ts.isExportDeclaration(p) ||
    ts.isLiteralTypeNode(p) ||
    ts.isCaseClause(p) ||
    ts.isElementAccessExpression(p) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText(sf))) ||
    ts.isTaggedTemplateExpression(p) ||
    ts.isJsxAttribute(p)
  );
}

// True when the nearest enclosing call is an internal one (error constructors, logs, SQL, string
// helpers) or the literal is thrown.
function insideInternalCall(node: ts.Node, sf: ts.SourceFile): boolean {
  let p: ts.Node = node.parent;
  while (!ts.isSourceFile(p)) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      return INTERNAL_CALLS.has(p.expression.getText(sf).split(".").pop() ?? "");
    }
    if (ts.isThrowStatement(p)) return true;
    if (ts.isBlock(p) || ts.isVariableStatement(p)) return false;
    p = p.parent;
  }
  return false;
}

// Outside copy modules a bare literal is UI text only if it reads like copy: it starts with a
// capital (internal messages like "upsert failed" do not), is not a class list, and sits neither
// in a structural position nor inside an internal call.
function isLooseUiLiteral(node: ts.Node, sf: ts.SourceFile): boolean {
  const text = ts.isTemplateExpression(node) ? node.head.text : (node as ts.StringLiteral).text;
  if (!/^[A-Z(+]/.test(text.trim()) || looksLikeClassList(text)) return false;
  return !isStructuralPosition(node, sf) && !insideInternalCall(node, sf);
}

function literalText(e: ts.Node | undefined): string | null {
  if (e === undefined) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isJsxExpression(e)) return literalText(e.expression);
  if (ts.isTemplateExpression(e)) {
    return [e.head.text, ...e.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  if (ts.isConditionalExpression(e)) {
    return [literalText(e.whenTrue), literalText(e.whenFalse)].filter((x) => x !== null).join(" ");
  }
  return null;
}

// The text a node shows on screen, or null when the node is not UI copy.
function visibleText(node: ts.Node, sf: ts.SourceFile, allStrings: boolean): string | null {
  if (ts.isJsxText(node)) return node.text;
  if (ts.isJsxAttribute(node)) {
    return VISIBLE_ATTRS.has(node.name.getText(sf)) ? literalText(node.initializer) : null;
  }
  if (ts.isJsxExpression(node)) {
    return ts.isJsxElement(node.parent) ? literalText(node.expression) : null;
  }
  if (ts.isPropertyAssignment(node)) {
    const key = node.name.getText(sf).replace(/["']/g, "");
    return VISIBLE_ATTRS.has(key) ? literalText(node.initializer) : null;
  }
  if (ts.isParameter(node) || ts.isBindingElement(node)) {
    // Default props like `placeholder = "Select"`.
    const name = node.name.getText(sf);
    return VISIBLE_ATTRS.has(name) ? literalText(node.initializer) : null;
  }
  const isLiteral =
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node);
  return isLiteral && (allStrings || isLooseUiLiteral(node, sf)) ? literalText(node) : null;
}

function visit(sf: ts.SourceFile, out: UiText[], allStrings: boolean): void {
  const walk = (node: ts.Node): void => {
    const text = visibleText(node, sf, allStrings);
    if (text !== null && looksEnglish(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ file: sf.fileName, line: line + 1, text: text.trim() });
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

const SKIP_DIRS = new Set(["node_modules", "test", "testing", "mcp", "demo"]);
// Wire-protocol code: header names ("To", "Date"), MIME and OData syntax, never shown as copy.
const PROTOCOL_FILE =
  /features\/email\/(mime|mimeParse|imap\w*|outlook\w*|gmail\w*|resyncTestHarness|draftRow)\.ts$|Fixtures\.ts$|Sql\.ts$|testCaller\.ts$|TestHelpers\.ts$/;

function uiFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) uiFiles(full, acc);
    } else if (
      /\.tsx?$/.test(e.name) &&
      !/\.test(-helpers)?\.tsx?$|\.d\.ts$/.test(e.name) &&
      !PROTOCOL_FILE.test(full)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

// Copy modules hold nothing but UI text, so every string literal in them is checked.
function isCopyModule(file: string): boolean {
  return /(strings|Strings|copy|Copy|Labels?)\.ts$/.test(file);
}

// Label maps (Record<Key, string> named *_LABEL(S)) hold UI copy wherever they live.
function labelMapValues(sf: ts.SourceFile, out: UiText[]): void {
  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      /LABEL|_COPY|_NAMES|_TEXT/.test(node.name.getText(sf)) &&
      node.initializer !== undefined
    ) {
      const inner = (n: ts.Node): void => {
        if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.initializer)) {
          const t = n.initializer.text;
          if (looksEnglish(t)) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            out.push({ file: sf.fileName, line: line + 1, text: t.trim() });
          }
        }
        ts.forEachChild(n, inner);
      };
      inner(node.initializer);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

export function scanUiText(srcRoot: string): UiText[] {
  const out: UiText[] = [];
  for (const file of uiFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      path.relative(srcRoot, file),
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    visit(sf, out, isCopyModule(file));
    labelMapValues(sf, out);
  }
  return out;
}
