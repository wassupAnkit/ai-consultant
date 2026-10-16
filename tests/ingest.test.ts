import { describe, expect, test } from "bun:test";
import { ReindexRequestSchema } from "../src/app/http";
import { courseUrlScore, crawlPriority, detectCoursePage } from "../src/ingest/course-detect";
import { crawl, emptyCrawlStats } from "../src/ingest/crawler";
import { extractJsonLd, extractPage } from "../src/ingest/extract";
import { shouldSweep } from "../src/ingest/pipeline";
import { collectSitemapUrls, parseSitemap, sitemapCandidates } from "../src/ingest/sitemap";
import type { CrawlSource } from "../src/ingest/sources";
import { fakeFetch, htmlResponse, SAMPLE_HTML } from "./fakes";

const COURSE_HTML = `<!doctype html><html><head><title>Bachelor of Nursing - Example University</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Course","name":"Bachelor of Nursing","provider":{"@type":"CollegeOrUniversity","name":"Example University"}}</script>
</head><body><main><h1>Bachelor of Nursing</h1>
<h2>Duration</h2><p>3 years full time. Intakes: February and July. Campus: Sydney.</p>
<h2>Entry requirements</h2><p>ATAR 75 or equivalent. English: IELTS 7.0 overall with no band below 7.0.</p>
<h2>Fees</h2><p>International tuition: AUD 38,400 per year (2026 indicative). CRICOS code 012345A.</p>
<p><a href="/courses/bachelor-of-midwifery">Bachelor of Midwifery</a> <a href="/news/open-day">Open day</a></p>
</main></body></html>`;

describe("sitemaps", () => {
  test("candidates come from robots.txt plus conventional paths", () => {
    const c = sitemapCandidates("https://www.example.edu", "User-agent: *\nDisallow: /admin\nSitemap: https://www.example.edu/sitemaps/courses.xml\nsitemap: /other.xml\n");
    expect(c[0]).toBe("https://www.example.edu/sitemaps/courses.xml");
    expect(c[1]).toBe("https://www.example.edu/other.xml");
    expect(c).toContain("https://www.example.edu/sitemap.xml");
    expect(c).toContain("https://www.example.edu/sitemap_index.xml");
  });

  test("parseSitemap handles urlsets, indexes, CDATA and lastmod", () => {
    const urlset = parseSitemap(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc><![CDATA[https://www.example.edu/courses/a]]></loc><lastmod>2026-08-01</lastmod></url>
      <url><loc>https://www.example.edu/courses/b</loc><lastmod>not-a-date</lastmod></url></urlset>`);
    expect(urlset.urls.map((u) => u.loc)).toEqual(["https://www.example.edu/courses/a", "https://www.example.edu/courses/b"]);
    expect(urlset.urls[0]!.lastmod?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(urlset.urls[1]!.lastmod).toBeUndefined();
    expect(urlset.sitemaps).toEqual([]);
    const index = parseSitemap(`<sitemapindex><sitemap><loc>https://www.example.edu/sitemap-courses.xml</loc></sitemap><sitemap><loc>https://www.example.edu/sitemap-news.xml.gz</loc></sitemap></sitemapindex>`);
    expect(index.sitemaps).toHaveLength(2);
    expect(index.urls).toHaveLength(0);
  });

  test("collectSitemapUrls follows an index, applies allow/deny and reads gzip", async () => {
    const origin = "https://www.example.edu";
    const gz = Bun.gzipSync(new TextEncoder().encode(`<urlset><url><loc>${origin}/courses/gz-course</loc></url></urlset>`));
    const fetchImpl = fakeFetch({
      [`${origin}/sitemap.xml`]: new Response(`<sitemapindex><sitemap><loc>${origin}/sitemap-courses.xml</loc></sitemap><sitemap><loc>${origin}/sitemap-gz.xml.gz</loc></sitemap></sitemapindex>`, { headers: { "content-type": "application/xml" } }),
      [`${origin}/sitemap-courses.xml`]: new Response(
        `<urlset><url><loc>${origin}/courses/a</loc><lastmod>2026-08-01</lastmod></url><url><loc>${origin}/news/x</loc></url><url><loc>${origin}/courses/b?tab=fees</loc></url></urlset>`,
        { headers: { "content-type": "application/xml" } },
      ),
      [`${origin}/sitemap-gz.xml.gz`]: new Response(gz, { headers: { "content-type": "application/gzip" } }),
    });
    const { entries, filesRead } = await collectSitemapUrls(origin, { fetchImpl, userAgent: "t", allow: [/^https:\/\/www\.example\.edu\/courses\//], deny: [/\?/] });
    expect(filesRead).toBe(3);
    expect(entries.map((e) => e.loc).sort()).toEqual([`${origin}/courses/a`, `${origin}/courses/gz-course`]);
    expect(entries.find((e) => e.loc.endsWith("/a"))!.lastmod).toBeInstanceOf(Date);
  });
});

describe("course detection", () => {
  test("URL scores favour catalog pages and penalise news/staff", () => {
    expect(courseUrlScore("https://www.monash.edu/study/courses/find-a-course/information-technology-c6001")).toBeGreaterThan(3);
    expect(courseUrlScore("https://www.example.edu/news/2026/open-day")).toBeLessThan(0);
    expect(crawlPriority("https://www.example.edu/courses/bachelor-of-nursing")).toBeGreaterThan(crawlPriority("https://www.example.edu/about/"));
  });

  test("detectCoursePage uses on-page signals and JSON-LD", async () => {
    const page = await extractPage(COURSE_HTML, "https://www.example.edu/courses/bachelor-of-nursing");
    expect(page.jsonLd).toHaveLength(1);
    const d = detectCoursePage(page);
    expect(d.isCourse).toBe(true);
    expect(d.hasCourseJsonLd).toBe(true);
    expect(d.signals).toEqual(expect.arrayContaining(["duration", "intake", "entry", "english", "fees", "code", "campus", "json-ld"]));
    const generic = await extractPage(`<html><head><title>About us</title></head><body><main><h1>About</h1><p>We were founded in 1965 and have three campuses.</p></main></body></html>`, "https://www.example.edu/about/");
    expect(detectCoursePage(generic).isCourse).toBe(false);
    // Fees + entry + duration on a neutral URL still counts; news URL never does.
    const news = await extractPage(COURSE_HTML, "https://www.example.edu/news/fees-update");
    expect(detectCoursePage({ ...news, jsonLd: [] }).isCourse).toBe(false);
  });

  test("extractJsonLd skips malformed blocks and flattens arrays", () => {
    const out = extractJsonLd(`<script type="application/ld+json">[{"@type":"Course"},{"@type":"Organization"}]</script><script type="application/ld+json">{bad json</script>`);
    expect(out).toHaveLength(2);
  });
});

describe("crawler", () => {
  const origin = "https://www.example.edu";
  const source: CrawlSource = {
    name: "partner:example-university",
    partnerSlug: "example-university",
    seeds: [`${origin}/`],
    allow: [new RegExp(`^${origin.replace(/\./g, "\\.")}(/courses|/about|/?$)`)],
    deny: [/\/news\//],
    maxPages: 10,
    maxDepth: 2,
    country: "australia",
    docType: "partner_university",
  };
  const pages: Record<string, Response> = {
    [`${origin}/`]: htmlResponse(
      `<html><head><title>Home</title></head><body><main><p>Welcome to Example University, a great place to study with many courses.</p><a href="/about/">About</a><a href="/courses/bachelor-of-nursing">Nursing</a><a href="/courses/bachelor-of-midwifery">Midwifery</a><a href="/news/x">News</a></main></body></html>`,
      `${origin}/`,
    ),
    [`${origin}/about/`]: htmlResponse(`<html><head><title>About</title></head><body><main><p>Founded 1965. Three campuses across the state and a long history of teaching.</p></main></body></html>`, `${origin}/about/`),
    [`${origin}/courses/bachelor-of-nursing/`]: htmlResponse(COURSE_HTML, `${origin}/courses/bachelor-of-nursing/`),
    [`${origin}/courses/bachelor-of-midwifery/`]: htmlResponse(SAMPLE_HTML, `${origin}/courses/bachelor-of-midwifery/`),
    [`${origin}/courses/from-sitemap/`]: htmlResponse(SAMPLE_HTML, `${origin}/courses/from-sitemap/`),
    [`${origin}/robots.txt`]: new Response(`User-agent: *\nDisallow: /private/\nSitemap: ${origin}/sitemap.xml\n`),
    [`${origin}/sitemap.xml`]: new Response(`<urlset><url><loc>${origin}/courses/from-sitemap</loc><lastmod>2026-08-01</lastmod></url><url><loc>${origin}/courses/bachelor-of-nursing</loc><lastmod>2020-01-01</lastmod></url></urlset>`, { headers: { "content-type": "application/xml" } }),
  };

  test("prioritises course URLs, seeds from sitemaps, skips unchanged lastmod and records stats", async () => {
    const fetchImpl = fakeFetch(pages);
    const stats = emptyCrawlStats();
    const skipped: string[] = [];
    const seen: string[] = [];
    for await (const p of crawl(source, {
      userAgent: "t",
      concurrency: 1,
      delayMs: 0,
      fetchImpl,
      useSitemaps: true,
      prioritize: crawlPriority,
      stats,
      skipUnchanged: async (url, lastmod) => {
        // Pretend we last crawled everything on 2025-01-01.
        const skip = Boolean(lastmod && lastmod < new Date("2025-01-01"));
        if (skip) skipped.push(url);
        return skip;
      },
    })) {
      seen.push(p.page.url);
    }
    expect(stats.sitemapUrls).toBe(2);
    expect(skipped).toEqual([`${origin}/courses/bachelor-of-nursing/`]);
    // Course pages (from the sitemap and links) come before the about page; home is a seed at depth 0.
    expect(seen[0]).toBe(`${origin}/courses/from-sitemap/`);
    expect(seen).toContain(`${origin}/courses/bachelor-of-midwifery/`);
    expect(seen.indexOf(`${origin}/courses/bachelor-of-midwifery/`)).toBeLessThan(seen.indexOf(`${origin}/about/`));
    expect(seen).not.toContain(`${origin}/news/x/`);
    expect(stats.fetched).toBe(seen.length);
    expect(stats.truncated).toBe(false);
  });

  test("deadline and page limit mark the crawl truncated", async () => {
    const fetchImpl = fakeFetch(pages);
    const stats = emptyCrawlStats();
    const seen: string[] = [];
    for await (const p of crawl({ ...source, maxPages: 1 }, { userAgent: "t", concurrency: 1, delayMs: 0, fetchImpl, stats })) seen.push(p.page.url);
    expect(seen).toHaveLength(1);
    expect(stats.truncated).toBe(true);
    const stats2 = emptyCrawlStats();
    let count = 0;
    for await (const _ of crawl(source, { userAgent: "t", concurrency: 1, delayMs: 0, fetchImpl, stats: stats2, deadline: Date.now() - 1 })) count++;
    expect(count).toBe(0);
  });
});

describe("orphan sweep guard", () => {
  test("shouldSweep refuses truncated or suspiciously small crawls", () => {
    expect(shouldSweep(120, 130, false).ok).toBe(true);
    expect(shouldSweep(120, null, false).ok).toBe(true);
    expect(shouldSweep(120, 130, true)).toMatchObject({ ok: false, reason: expect.stringContaining("truncated") });
    expect(shouldSweep(0, 130, false).ok).toBe(false);
    expect(shouldSweep(40, 130, false)).toMatchObject({ ok: false, reason: expect.stringContaining("40 pages vs 130") });
    expect(shouldSweep(66, 130, false).ok).toBe(true);
  });

  test("ReindexRequestSchema accepts known scopes only", () => {
    expect(ReindexRequestSchema.parse({ scope: "partner:monash-university", force: true }).force).toBe(true);
    expect(ReindexRequestSchema.parse({ scope: "all" }).scope).toBe("all");
    expect(ReindexRequestSchema.parse({ scope: "guides" }).scope).toBe("guides");
    expect(() => ReindexRequestSchema.parse({ scope: "upload:abc" })).toThrow();
    expect(() => ReindexRequestSchema.parse({ scope: "partner:Bad Slug" })).toThrow();
  });
});

describe("forms in extracted pages", () => {
  test("a form wrapping the page (ASP.NET, SharePoint) is unwrapped; a search or sign-up form is dropped", async () => {
    const page = await extractPage(
      `<html><head><title>Genuine Student requirement</title></head><body>
        <form method="post" action="./genuine-student-requirement"><input type="hidden" name="__VIEWSTATE" value="x">
          <form-placeholder></form-placeholder>
          <main role="main"><h1>Genuine Student requirement</h1><p>The GS requirement applies to applications lodged on or after 23 March 2024.</p></main>
        </form>
        <form action="/search"><p>Search this site</p><input name="q"></form>
      </body></html>`,
      "https://immi.homeaffairs.gov.au/visas/student-500/genuine-student-requirement",
    );
    expect(page.text).toContain("lodged on or after 23 March 2024");
    expect(page.text).not.toContain("Search this site");
  });
});
