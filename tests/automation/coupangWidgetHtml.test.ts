import { describe, expect, it } from "vitest";

describe("Coupang HTML insertion", () => {
  it("adds the provided widget immediately after the first two H2 headings", async () => {
    const { insertCoupangWidgetsAfterFirstTwoH2: insert } = await import("../../src/automation/coupangWidgetHtml");

    const html = "<h2>First</h2><p>First paragraph</p><h2 class=\"title\">Second</h2><p>Second paragraph</p><h2>Third</h2>";
    const widget = '<script src="https://ads-partners.coupang.com/g.js"></script>\n' +
      '<script> new PartnersCoupang.G({"id":1011906,"template":"carousel","trackingCode":"AF3152596","width":"680","height":"200","tsource":""}); </script>';

    expect(insert(html)).toBe(
      `<h2>First</h2>\n${widget}\n<p>First paragraph</p><h2 class="title">Second</h2>\n${widget}\n<p>Second paragraph</p><h2>Third</h2>`
    );
  });

  it("fails closed when fewer than two H2 headings are present", async () => {
    const { insertCoupangWidgetsAfterFirstTwoH2: insert } = await import("../../src/automation/coupangWidgetHtml");

    expect(() => insert("<h2>Only one</h2><p>Body</p>"))
      .toThrow("Coupang widgets require at least two H2 headings; found 1.");
  });
});
