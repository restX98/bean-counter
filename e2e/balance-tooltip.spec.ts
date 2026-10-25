import { expect, test, type Locator, type Page } from "@playwright/test";
import { startFrom } from "./states.ts";

// S11: pointing at a day, or touching it, shows that day's balances.
// Main checking runs from 1 September, Savings from 5 October.

/** Room the chart keeps on its left for the amounts. */
const AXIS = 44;

async function chart(page: Page) {
  const area = page.getByRole("img", { name: /Balance per account/ });
  await expect(area).toBeVisible();
  // The chart draws once it knows its width.
  await expect(area.locator("svg")).toBeVisible();
  const box = (await area.boundingBox())!;
  const y = box.y + 60;
  // The plot's first and last pixel: its first and last day.
  return {
    box,
    first: { x: box.x + AXIS + 1, y },
    last: { x: box.x + box.width - 1, y },
  };
}

const tip = (page: Page) => page.locator(".chart-tip");

async function side(tooltip: Locator, x: number) {
  const box = (await tooltip.boundingBox())!;
  return box.x + box.width <= x ? "left" : "right";
}

test.beforeEach(async ({ request }) => {
  await startFrom(request, "october");
});

test("pointing at a day shows its balances, beside it where there's room", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A pointer, not a finger.");
  await page.goto("/reports?range=1Y");
  const { box, first, last } = await chart(page);

  // The first day: Savings isn't known yet.
  let point = first;
  await page.mouse.move(point.x, point.y);
  await expect(tip(page)).toContainText("01/09/2026");
  await expect(tip(page)).toContainText("— Savings");
  await expect(tip(page)).toContainText("2,024.60 € Main checking");
  await expect(tip(page)).toContainText("2,024.60 € Total");
  expect(await side(tip(page), point.x)).toBe("right");

  // The last day: both accounts, and the tooltip on the left.
  point = last;
  await page.mouse.move(point.x, point.y);
  await expect(tip(page)).toContainText("12,505.00 € Savings");
  await expect(tip(page)).toContainText("15,189.20 € Total");
  expect(await side(tip(page), point.x)).toBe("left");

  // Leaving the chart hides it.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect(tip(page)).toHaveCount(0);
});

test("a touched day stays shown until a touch somewhere else", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "A finger, not a pointer.");
  await page.goto("/reports?range=1Y");
  const { box, last } = await chart(page);

  const point = last;
  await page.touchscreen.tap(point.x, point.y);
  await expect(tip(page)).toContainText("15,189.20 € Total");

  await page.touchscreen.tap(box.x + 20, box.y - 40);
  await expect(tip(page)).toHaveCount(0);
});
