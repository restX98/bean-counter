import { expect, test } from "@playwright/test";
import { addAccount, startFrom } from "./states.ts";

// Plan §6, flow 10: download a backup in S18; later, restore it through D8
// and land on S1.
test("download a backup, then restore it over newer data", async ({
  page,
  request,
}, testInfo) => {
  await startFrom(request, "october");

  // S18: Download backup.
  await page.goto("/settings");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^bean-counter-backup-\d{4}-\d{2}-\d{2}\.db$/,
  );
  const backup = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(backup);
  await expect(page.getByText(/^Last backup downloaded: /)).toBeVisible();

  // Newer data, which the restore will replace.
  await addAccount(request, "Cash card", "checking");

  // S18 → choose the file → D8, which downloads the current data first.
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from file…" }).click();
  await (await choosing).setFiles(backup);
  const dialog = page.getByRole("dialog", { name: "Restore from backup?" });
  await expect(dialog).toContainText(download.suggestedFilename());
  await expect(
    dialog.getByRole("checkbox", {
      name: "Download a backup of the current data first",
    }),
  ).toBeChecked();
  const safety = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Replace all data" }).click();
  await safety;

  // S1, with the data as it was in the backup.
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /Main checking/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cash card/ })).toHaveCount(0);
});
