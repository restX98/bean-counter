import { expect, test, type Locator } from "@playwright/test";
import { startFrom } from "./states.ts";

// The app follows the system's theme. With the system set to dark, every
// main screen and a dialog are dark, and their text stays readable: 4.5:1
// or more against what's behind it (CLAUDE.md, Design tokens).
test.use({ colorScheme: "dark" });

interface Colors {
  /** Relative luminance of the background, 0 (black) to 1 (white). */
  background: number;
  /** Contrast of the text against that background, 1 to 21. */
  contrast: number;
}

/** The element's text color against the first background behind it. */
function colorsOf(element: Locator): Promise<Colors> {
  // Runs in the page. The e2e code is checked without the browser's types,
  // so the page's own window gives getComputedStyle.
  return element.evaluate((start) => {
    const style = (node: typeof start) =>
      node.ownerDocument.defaultView!.getComputedStyle(node);
    const rgb = (value: string) => {
      const match =
        /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/.exec(
          value,
        );
      if (!match) throw new Error(`Can't read the color ${value}`);
      const [r, g, b, a = "1"] = match.slice(1);
      return { rgb: [r, g, b].map(Number), alpha: Number(a) };
    };
    const luminance = ([r, g, b]: number[]) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    let node: typeof start | null = start;
    let background = rgb("rgb(255, 255, 255)").rgb;
    while (node) {
      const color = rgb(style(node).backgroundColor);
      if (color.alpha > 0) {
        background = color.rgb;
        break;
      }
      node = node.parentElement as typeof start | null;
    }
    const text = luminance(rgb(style(start).color).rgb);
    const back = luminance(background);
    const [light, dark] = text > back ? [text, back] : [back, text];
    return { background: back, contrast: (light + 0.05) / (dark + 0.05) };
  });
}

async function expectDark(element: Locator) {
  await expect(element).toBeVisible();
  const colors = await colorsOf(element);
  expect(colors.background, "a dark background").toBeLessThan(0.1);
  expect(colors.contrast, "readable text").toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async ({ request }) => {
  await startFrom(request, "october");
});

for (const [name, path] of [
  ["dashboard", "/"],
  ["review", "/review"],
  ["accounts", "/accounts"],
  ["transactions", "/transactions"],
  ["balance over time", "/reports"],
  ["monthly report", "/reports/monthly"],
  ["budgets", "/budgets"],
  ["categories", "/categories"],
  ["settings", "/settings"],
] as const) {
  test(`the ${name} screen is dark`, async ({ page }) => {
    await page.goto(path);
    await expectDark(page.locator("h1").first());
    await expectDark(page.locator("body"));
    const card = page.locator(".card").first();
    if ((await card.count()) > 0) {
      await expectDark(card.locator("h2, strong, span").first());
    }
  });
}

test("a dialog is dark", async ({ page }) => {
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: /^Add( account)?$/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add account" });
  await expectDark(dialog.getByText("Name", { exact: true }));
  await expectDark(dialog.getByRole("heading", { name: "Add account" }));
});
