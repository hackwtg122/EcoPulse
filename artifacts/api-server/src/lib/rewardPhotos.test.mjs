import test from "node:test";
import assert from "node:assert/strict";
import { parsePhysicalRewardPhoto } from "./rewardPhotos.ts";

const valid = {
  imageUrl: "https://supplier.example/products/steel-bottle.jpg",
  sourceUrl: "https://supplier.example/products/steel-bottle",
  photoConfirmed: true,
};
test("real physical reward photo requires admin attestation, HTTPS and source", () => {
  assert.deepEqual(parsePhysicalRewardPhoto(valid), valid);
  for (const invalid of [
    { ...valid, photoConfirmed: false },
    { ...valid, photoConfirmed: undefined },
    { ...valid, imageUrl: "http://supplier.example/img.jpg" },
    { ...valid, imageUrl: "https://127.0.0.1/image.jpg" },
    { ...valid, imageUrl: "https://supplier.example/image.jpg#fragment" },
    { ...valid, sourceUrl: "https://user:secret@supplier.example/product" },
    { ...valid, sourceUrl: "http://supplier.example/item" },
    { ...valid, extra: "not allowed" },
  ]) assert.throws(() => parsePhysicalRewardPhoto(invalid), { code: "invalid_reward_photo" });
});
