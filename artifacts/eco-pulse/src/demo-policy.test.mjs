import assert from "node:assert/strict";
import test from "node:test";
import { validateDemoImage, MAX_DEMO_IMAGE_BYTES } from "./demo-policy.ts";

test("solo admite JPG y PNG de hasta 5 MB", () => {
  assert.equal(validateDemoImage({ type: "image/jpeg", size: 1 }), null);
  assert.equal(validateDemoImage({ type: "image/png", size: MAX_DEMO_IMAGE_BYTES }), null);
  assert.match(validateDemoImage({ type: "image/svg+xml", size: 100 }), /JPG/);
  assert.match(validateDemoImage({ type: "image/png", size: MAX_DEMO_IMAGE_BYTES + 1 }), /5 MB/);
  assert.match(validateDemoImage({ type: "image/jpeg", size: 0 }), /5 MB/);
});
