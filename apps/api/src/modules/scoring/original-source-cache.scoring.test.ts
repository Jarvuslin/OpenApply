import type { OriginalResumeSource } from "./original-source";
import { OriginalSourceCache } from "./original-source-cache";
import { ScoringService } from "./scoring.service";
import { scoringServiceFixture } from "./service-fakes";
import { expect, test } from "bun:test";

test("warm extraction still rereads bytes and checks current resume ownership for every scoring context", async () => {
  const { db, state, request } = scoringServiceFixture();
  let reads = 0;
  let parses = 0;
  const cache = new OriginalSourceCache(
    async () => {
      reads++;
      return Buffer.from(state.sourceText);
    },
    async (bytes) => {
      parses++;
      return bytes.toString();
    },
  );
  const sources: OriginalResumeSource = { read: (filename) => cache.read(filename) };
  const service = new ScoringService(db, sources);
  const first = await service.context("u1", request);
  expect((await service.context("u1", request)).basis).toEqual(first.basis);
  expect({ reads, parses, ownedLookups: state.resumeSelections.length }).toEqual({
    reads: 2,
    parses: 1,
    ownedLookups: 2,
  });

  state.resume.userId = "another-user";
  await expect(service.context("u1", request)).rejects.toMatchObject({ status: 404 });
  expect({ reads, parses, ownedLookups: state.resumeSelections.length }).toEqual({
    reads: 2,
    parses: 1,
    ownedLookups: 3,
  });

  state.resume.userId = "u1";
  state.sourceText += "\nAn additional original source sentence.";
  const changed = await service.context("u1", request);
  expect(changed.basis.sourceSha256).not.toBe(first.basis.sourceSha256);
  expect(changed.basis.sourceTextSha256).not.toBe(first.basis.sourceTextSha256);
  expect(changed.resume.text).toBe(state.sourceText);
  expect({ reads, parses, ownedLookups: state.resumeSelections.length }).toEqual({
    reads: 3,
    parses: 2,
    ownedLookups: 4,
  });
  expect(state.writes).toBe(0);
});
