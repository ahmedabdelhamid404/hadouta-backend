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
