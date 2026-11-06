import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const profile = app.slice(app.indexOf("function ProfilePage("), app.indexOf("function NotificationsPanel("));
const displayName = app.slice(app.indexOf("function getDisplayName("), app.indexOf("function getUserEmail("));

test("profile edit prefills the name stored by EcoPulse signup", () => {
  assert.match(displayName, /unsafeMetadata\?\.firstName/);
  assert.match(displayName, /unsafeMetadata\?\.lastName/);
  assert.match(profile, /user\.firstName\?\.trim\(\) \|\| metadata\?\.firstName\?\.trim\(\) \|\| ""/);
  assert.match(profile, /user\.lastName\?\.trim\(\) \|\| metadata\?\.lastName\?\.trim\(\) \|\| ""/);
});

test("profile summary shows the same visible name as the header", () => {
  assert.match(profile, /Nombre completo<\/dt><dd className="font-semibold">\{getDisplayName\(user\)\}<\/dd>/);
  assert.doesNotMatch(profile, /user\.fullName \|\| "—"/);
});
