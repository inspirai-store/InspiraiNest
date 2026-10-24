import { marked } from "marked";
const plain = (n) => ({ type: n.type, ...n.text !== void 0 ? { text: n.text } : {}, ...n.marks?.filter((m) => !["textStyle", "underline"].includes(m.type)).length ? { marks: n.marks.filter((m) => !["textStyle", "underline"].includes(m.type)) } : {}, ...n.attrs ? { attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k, v]) => !["original", "fingerprint"].includes(k) && v !== null)) } : {}, ...n.content ? { content: n.content.map(plain) } : {} });
const fingerprint = (n) => JSON.stringify(plain(n));
function inline(tokens = []) {
  return tokens.flatMap((t) => {
    if (/^\[\^([^\]]+)\]$/.test(t.raw || "")) return [{ type: "footnoteReference", attrs: { label: t.raw.slice(2, -1) } }];
    const mark = (type, attrs) => inline(t.tokens || [{ type: "text", text: t.text }]).map((n) => ({ ...n, marks: [...n.marks || [], { type, ...attrs ? { attrs } : {} }] }));
    if (t.type === "strong") return mark("bold");
    if (t.type === "em") return mark("italic");
    if (t.type === "del") return mark("strike");
    if (t.type === "link") return mark("link", { href: t.href, target: null, rel: null, class: null });
    if (t.type === "br") return [{ type: "hardBreak" }];
    if (t.type === "codespan") return [{ type: "text", text: t.text, marks: [{ type: "code" }] }];
    if (t.tokens) return inline(t.tokens);
    const text = t.type === "text" || t.type === "escape" ? t.text : t.raw;
    if (!text) return [];
    return text.split(/(\[\^[^\]]+\])/g).filter(Boolean).map((part) => /^\[\^([^\]]+)\]$/.test(part) ? { type: "footnoteReference", attrs: { label: part.slice(2, -1) } } : { type: "text", text: part });
  });
}
function block(t) {
  let n;
  if (t.type === "heading") n = { type: "heading", attrs: { level: t.depth }, content: inline(t.tokens) };
  else if (t.type === "paragraph" || t.type === "text") n = { type: "paragraph", content: inline(t.tokens || [{ type: "text", text: t.text }]) };
  else if (t.type === "blockquote") n = { type: "blockquote", content: blocks(t.tokens) };
  else if (t.type === "list") n = { type: t.ordered ? "orderedList" : "bulletList", ...t.ordered ? { attrs: { start: t.start || 1, type: null } } : {}, content: t.items.map((item) => ({ type: "listItem", content: blocks(item.tokens) })) };
  else n = { type: "rawMarkdown", attrs: { raw: t.raw || "" } };
  if (t.type === "paragraph" && /^::media\[([A-Za-z][A-Za-z0-9_-]*)\]\s*$/.test(t.raw)) n = { type: "creationImage", attrs: { ref: t.raw.match(/^::media\[([^\]]+)/)[1] } };
  if (/^\[\^[^\]]+\]:/m.test(t.raw || "") || (t.tokens || []).some((x) => ["image", "html"].includes(x.type))) n = { type: "rawMarkdown", attrs: { raw: t.raw } };
  n.attrs = { ...n.attrs, original: t.raw || "", fingerprint: "" };
  n.attrs.fingerprint = fingerprint(n);
  return n;
}
function blocks(tokens) {
  const nodes = [];
  for (const t of tokens) {
    if (t.type === "space" && nodes.length) {
      nodes.at(-1).attrs.original += t.raw;
      continue;
    }
    nodes.push(block(t));
  }
  return nodes;
}
function parseMarkdown(text) {
  return { type: "doc", content: text ? blocks(marked.lexer(text)) : [{ type: "paragraph" }] };
}
const escapeText = (s) => s.replace(/([\\*_[\]`])/g, "\\$1");
function textOf(n) {
  if (n.type === "footnoteReference") return "[^" + n.attrs?.label + "]";
  if (n.type === "hardBreak") return "  \n";
  if (n.text !== void 0) {
    let s = n.marks?.some((m) => m.type === "code") ? "`" + n.text.replace(/`/g, "\\`") + "`" : escapeText(n.text);
    for (const m of n.marks || []) {
      if (m.type === "bold") s = "**" + s + "**";
      if (m.type === "italic") s = "*" + s + "*";
      if (m.type === "strike") s = "~~" + s + "~~";
      if (m.type === "link") s = "[" + s + "](" + String(m.attrs?.href || "").replace(/\)/g, "%29") + ")";
    }
    return s;
  }
  return (n.content || []).map(textOf).join("");
}
function serializeMarkdown(n) {
  if (n.attrs?.original !== null && n.attrs?.original !== void 0 && n.attrs.fingerprint === fingerprint(n)) return n.attrs.original;
  if (n.type === "doc") return (n.content || []).map(serializeMarkdown).join("");
  if (n.type === "rawMarkdown") return n.attrs?.raw || "";
  if (n.type === "creationImage") return "\n::media[" + n.attrs?.ref + "]\n\n";
  if (n.type === "paragraph") return textOf(n) + "\n\n";
  if (n.type === "heading") return "#".repeat(n.attrs?.level || 1) + " " + textOf(n) + "\n\n";
  if (n.type === "blockquote") return (n.content || []).map(serializeMarkdown).join("").trimEnd().split("\n").map((s) => "> " + s).join("\n") + "\n\n";
  if (n.type === "bulletList" || n.type === "orderedList") return (n.content || []).map((item, i) => {
    const prefix = n.type === "bulletList" ? "- " : String((n.attrs?.start || 1) + i) + ". ";
    return prefix + (item.content || []).map(serializeMarkdown).join("").trimEnd().replace(/\n/g, "\n" + " ".repeat(prefix.length));
  }).join("\n") + "\n\n";
  return textOf(n);
}
function locateAnchor(text, a) {
  if (!a.quote) return null;
  const hits = [];
  let start = 0;
  while (start <= text.length) {
    const p = text.indexOf(a.quote, start);
    if (p < 0) break;
    hits.push(p);
    start = p + 1;
  }
  if (hits.length === 1) return { from: hits[0], to: hits[0] + a.quote.length };
  const contextual = hits.filter((p) => (!a.prefix || text.slice(Math.max(0, p - a.prefix.length), p) === a.prefix) && (!a.suffix || text.slice(p + a.quote.length, p + a.quote.length + a.suffix.length) === a.suffix));
  return contextual.length === 1 ? { from: contextual[0], to: contextual[0] + a.quote.length } : null;
}
function indexDocument(doc) {
  let text = "", positions = [];
  doc.descendants((block2, pos) => {
    if (!block2.isTextblock) return;
    if (text) {
      text += "\n";
      positions.push(pos);
    }
    block2.descendants((node, offset) => {
      if (node.isText) {
        for (let i = 0; i < node.text.length; i++) {
          text += node.text[i];
          positions.push(pos + 1 + offset + i);
        }
      } else if (node.type.name === "hardBreak") {
        text += "\n";
        positions.push(pos + 1 + offset);
      }
    });
    return false;
  });
  return { text, positions };
}
export {
  fingerprint,
  indexDocument,
  locateAnchor,
  parseMarkdown,
  serializeMarkdown
};
