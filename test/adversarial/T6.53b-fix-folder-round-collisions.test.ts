import { expect, it } from "vitest";
import {
  T0,
  after,
  numberOf,
  setup,
  sync,
  versions,
} from "./T6.53b-fix-helpers";

setup(true);
const roundOf = async (ver: number) => {
  const vs = (await versions()).filter((v) => v.version === ver);
  return vs.map((v) => v.roundId);
};

it("a v2/ folder that appears AFTER a suffix round numbered 2 does not absorb the suffix files into its round", async () => {
  await sync(
    [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
    ],
    T0,
  );
  await sync(
    [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
      ["hr", "A_v2.jpg"],
    ],
    after(5),
  ); // suffix round 2
  await sync(
    [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
      ["hr", "A_v2.jpg"],
      ["r2hr", "B.jpg"],
    ],
    after(10),
  ); // folder v2 = round 2 exactly
  const ids = new Set(await roundOf(2));
  expect(ids.size).toBe(2); // A's suffix v2 and B's folder v2 must not share a round row
});

it("a v3/ folder that was deleted does not become a window round for later suffix deliveries", async () => {
  await sync(
    [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
      ["r3hr", "A.jpg"],
    ],
    T0,
  );
  const folderRound = (await versions()).find((v) => v.version === 3)!.roundId;
  expect(await numberOf(folderRound)).toBe(3);
  await sync(
    [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
      ["hr", "B_v2.jpg"],
    ],
    after(10),
  );
  const b2 = (await versions()).find((v) => v.version === 2)!;
  expect(b2.roundId).not.toBe(folderRound);
});
