import { describe, expect, it } from "vitest";
import { createDriveClient } from "../app/lib/server/drive";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import { buildFixtures } from "../app/lib/server/fixtures";

const FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function realClient(): { client: DriveClient; folder: string } {
  const files = [
    "2023:05:06 07:08:09",
    "2024:12:31 23:59:59",
    "2020:01:01 00:00:00",
  ].map((time, i) => ({
    id: `f${i}`,
    name: `p${i}.jpg`,
    mimeType: "image/jpeg",
    modifiedTime: "2024-01-02T03:04:05.123Z",
    imageMediaMetadata: { width: 10, height: 20, time },
  }));
  const fetchFn = async () =>
    new Response(JSON.stringify({ files }), {
      headers: { "content-type": "application/json" },
    });
  return {
    client: createDriveClient(async () => "tok", {
      fetch: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    }),
    folder: "folder",
  };
}

async function mockClient(): Promise<{ client: DriveClient; folder: string }> {
  const client = createMockDrive();
  const fx = buildFixtures();
  // any folder that directly holds photos
  const parent = fx.entries.find((e) => e.mimeType !== FOLDER_MIME)!.parentId!;
  return { client, folder: parent };
}

describe.each([
  ["real client (mocked fetch)", async () => realClient()],
  ["mock client", mockClient],
])("takenAt contract: %s", (_n, make) => {
  it("is exactly YYYY-MM-DDTHH:MM:SSZ (no milliseconds)", async () => {
    const { client, folder } = await make();
    const withTime = (await client.listChildren(folder)).filter(
      (f) => f.takenAt !== undefined,
    );
    expect(withTime.length).toBeGreaterThan(0);
    for (const f of withTime) expect(f.takenAt).toMatch(FORMAT);
  });
});

it("real client keeps the exact EXIF wall time", async () => {
  const { client, folder } = realClient();
  const t = (await client.listChildren(folder)).map((f) => f.takenAt);
  expect(t[0]).toBe("2023-05-06T07:08:09Z");
});
