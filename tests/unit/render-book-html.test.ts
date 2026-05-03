import { describe, expect, it } from "vitest";
import "dotenv/config";
import { buildHtml } from "../../src/lib/pdf/render-book.js";

const VALID_INPUT = {
  title: "هُنَا وَعيد ميلادها",
  dedication: "إلى هُنَا — قلبك الكبير هو أحلى هدية.",
  moralStatement:
    "وفي الآخر، عرفت هُنَا إن التعاون هو السر، وإن أحلى حاجة في الدنيا إننا نشتغل مع بعض.",
  coverUrl: "https://res.cloudinary.com/example/cover.png",
  pages: [
    {
      pageNumber: 1,
      storyText: "كان في يوم مشمس، هُنَا صحيت بدري عشان عيد ميلادها.",
      illustrationUrl: "https://res.cloudinary.com/example/p1.png",
      moralMoment: false,
    },
    {
      pageNumber: 2,
      storyText: "هُنَا قررت تطلب المساعدة من أصحابها.",
      illustrationUrl: "https://res.cloudinary.com/example/p2.png",
      moralMoment: true,
    },
  ],
};

describe("buildHtml — fonts + paper", () => {
  const html = buildHtml(VALID_INPUT);

  it("loads Aref Ruqaa, El Messiri, and Cairo from Google Fonts", () => {
    expect(html).toContain("Aref+Ruqaa");
    expect(html).toContain("El+Messiri");
    expect(html).toContain("Cairo");
  });

  it("includes paper-grain repeating gradients", () => {
    expect(html).toContain("repeating-linear-gradient");
  });

  it("uses cream-to-warm-cream radial paper background", () => {
    expect(html).toContain("#fffbf3");
    expect(html).toContain("#fbf4e6");
  });

  it("uses A5 page format and zero margin", () => {
    expect(html).toContain("148mm");
    expect(html).toContain("210mm");
  });

  it("RTL direction is set", () => {
    expect(html).toMatch(/dir=["']rtl["']/);
  });
});

describe("buildHtml — body pages", () => {
  const html = buildHtml(VALID_INPUT);

  it("renders one section per body page", () => {
    const matches = html.match(/<section[^>]*class="page body-page"/g);
    expect(matches).toHaveLength(VALID_INPUT.pages.length);
  });

  it("renders each page's text and illustration URL", () => {
    for (const p of VALID_INPUT.pages) {
      expect(html).toContain(p.storyText);
      expect(html).toContain(p.illustrationUrl);
    }
  });

  it("renders Eastern Arabic page numbers", () => {
    expect(html).toContain("٢");
  });

  it("renders moral-moment label only on moralMoment pages", () => {
    const labelOccurrences = (html.match(/لحظة الحكاية/g) || []).length;
    const moralPages = VALID_INPUT.pages.filter((p) => p.moralMoment);
    expect(labelOccurrences).toBe(moralPages.length);
  });

  it("includes inner border + corner flourishes in body-page CSS", () => {
    expect(html).toMatch(/\.body-page::before[^}]*border:/);
    expect(html).toContain("corner-flourish");
  });
});

describe("buildHtml — cover", () => {
  const html = buildHtml(VALID_INPUT);

  it("includes the cover illustration img with the cover URL", () => {
    expect(html).toContain('class="cover-illus"');
    expect(html).toContain(VALID_INPUT.coverUrl);
  });

  it("renders the title in El Messiri terracotta", () => {
    expect(html).toContain(VALID_INPUT.title);
    expect(html).toMatch(/\.cover-title[^}]*color:\s*#c66a3d/i);
    expect(html).toMatch(/\.cover-title[^}]*El Messiri/);
  });

  it("renders the dedication in italic", () => {
    expect(html).toContain(VALID_INPUT.dedication);
    expect(html).toMatch(/\.cover-dedication[^}]*font-style:\s*italic/);
  });

  it("includes the brand wordmark", () => {
    expect(html).toContain("حدوتة");
  });

  it("uses 75% illustration height (poster register)", () => {
    expect(html).toMatch(/\.cover-illus[^}]*height:\s*75%/);
  });
});
