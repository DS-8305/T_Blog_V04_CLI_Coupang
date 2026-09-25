const coupangWidgetHtml = [
  '<script src="https://ads-partners.coupang.com/g.js"></script>',
  '<script> new PartnersCoupang.G({"id":1011906,"template":"carousel","trackingCode":"AF3152596","width":"680","height":"200","tsource":""}); </script>'
].join("\n");

export function insertCoupangWidgetsAfterFirstTwoH2(html: string): string {
  const headings = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2\s*>/gi)];
  if (headings.length < 2) {
    throw new Error(`Coupang widgets require at least two H2 headings; found ${headings.length}.`);
  }

  let result = html;
  for (const heading of headings.slice(0, 2).reverse()) {
    const insertionIndex = (heading.index ?? 0) + heading[0].length;
    result = `${result.slice(0, insertionIndex)}\n${coupangWidgetHtml}\n${result.slice(insertionIndex)}`;
  }
  return result;
}
