/**
 * HTML → structured text using Bun's built-in HTMLRewriter (no dependencies).
 * Produces a title, meta description and a list of sections (heading path +
 * text) that the chunker turns into knowledge-base chunks.
 */
export interface ExtractedSection {
  heading: string;
  level: number;
  text: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  lang: string | null;
  canonical: string | null;
  sections: ExtractedSection[];
  /** Absolute URLs of same-document links, for crawling. */
  links: string[];
  text: string;
  /** Parsed `<script type="application/ld+json">` objects (schema.org Course etc.), when present. */
  jsonLd?: unknown[];
}

const JSON_LD = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Extract JSON-LD blocks before the script tags are dropped; malformed blocks are skipped. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(JSON_LD)) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* ignore */
    }
  }
  return out;
}

const DROP_BLOCKS = /<(script|style|noscript|svg|template|iframe|canvas|video|audio|object|button|select|textarea)\b[\s\S]*?<\/\1>/gi;
/**
 * Forms (search boxes, sign-ups) are dropped, except a form wrapping the page itself: ASP.NET and
 * SharePoint sites (immi.homeaffairs.gov.au, some universities) put the whole body, main content
 * included, inside one `<form>`. That one is unwrapped. HTML forbids nested forms, so a lazy match
 * spans exactly one form.
 */
const FORM_BLOCK = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
const PAGE_CONTENT = /<main\b|role=["']main["']|<h1\b|<article\b/i;
const DROP_COMMENTS = /<!--[\s\S]*?-->/g;
const BOILERPLATE_SELECTOR = "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .cookie, .cookie-banner, .breadcrumb, .breadcrumbs, .menu, .sidebar";
const TEXT_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, blockquote, figcaption, pre";

export async function extractPage(html: string, url: string): Promise<ExtractedPage> {
  const jsonLd = extractJsonLd(html);
  const cleaned = html
    .replace(DROP_COMMENTS, "")
    .replace(DROP_BLOCKS, "")
    .replace(FORM_BLOCK, (_, inner: string) => (PAGE_CONTENT.test(inner) ? inner : ""));
  let title = "";
  let description = "";
  let lang: string | null = null;
  let canonical: string | null = null;
  const links = new Set<string>();
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection = { heading: "", level: 0, text: "" };
  let buffer = "";
  let bufferTag = "";
  let skipDepth = 0;

  const flush = () => {
    const t = normalizeWhitespace(buffer);
    buffer = "";
    if (!t) return;
    if (/^h[1-6]$/.test(bufferTag)) {
      const level = Number(bufferTag[1]);
      if (current.text.trim() || current.heading) sections.push(current);
      current = { heading: t, level, text: "" };
      if (!title && level === 1) title = t;
    } else {
      current.text += (bufferTag === "li" ? "- " : "") + t + "\n";
    }
  };

  const rewriter = new HTMLRewriter()
    .on("html", { element: (el) => void (lang = el.getAttribute("lang")) })
    .on("title", {
      text: (t) => {
        title += t.text;
      },
    })
    .on("meta[name=description]", { element: (el) => void (description = el.getAttribute("content") ?? "") })
    .on("link[rel=canonical]", { element: (el) => void (canonical = el.getAttribute("href")) })
    .on("a[href]", {
      element: (el) => {
        const href = el.getAttribute("href");
        if (!href) return;
        const abs = absolutize(href, url);
        if (abs) links.add(abs);
      },
    })
    .on(BOILERPLATE_SELECTOR, {
      element: (el) => {
        // Void/self-closing elements (img, input, br…) have no end tag: nothing to skip.
        if (!onEndTag(el, () => void skipDepth--)) return;
        skipDepth++;
      },
    })
    .on(TEXT_SELECTOR, {
      element: (el) => {
        if (skipDepth > 0) return;
        flush();
        bufferTag = el.tagName.toLowerCase();
        onEndTag(el, () => flush());
      },
      text: (t) => {
        if (skipDepth > 0) return;
        buffer += t.text;
      },
    });

  await rewriter.transform(new Response(cleaned)).text();
  flush();
  if (current.text.trim() || current.heading) sections.push(current);

  title = normalizeWhitespace(title).replace(/\s*[|–-]\s*(Expert Education.*|Main Site)$/i, "").trim();
  const text = sections
    .map((s) => (s.heading ? `${"#".repeat(Math.max(1, Math.min(6, s.level || 2)))} ${s.heading}\n${s.text}` : s.text))
    .join("\n")
    .trim();

  return { url, title, description: normalizeWhitespace(description), lang, canonical, sections, links: [...links], text, ...(jsonLd.length ? { jsonLd } : {}) };
}

/** Register an end-tag handler; returns false for void elements, which have none. */
function onEndTag(el: { onEndTag(handler: () => void): void; selfClosing?: boolean; removed?: boolean }, handler: () => void): boolean {
  try {
    el.onEndTag(handler);
    return true;
  } catch {
    return false;
  }
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function absolutize(href: string, base: string): string | null {
  try {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
