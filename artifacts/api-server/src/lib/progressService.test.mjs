import assert from "node:assert/strict";
import test from "node:test";
import { computeProgress, progressRules } from "./progressService.ts";

const daysAgo = (n) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date;
};

test("empty account has zero progress, level 1, and no earned badges", () => {
  const report = computeProgress([], []);
  assert.equal(report.ecoXp, 0);
  assert.equal(report.level, 1);
  assert.equal(report.levelTitle, "Semilla");
  assert.equal(report.streakDays, 0);
  assert.ok(report.badges.every((badge) => !badge.earned));
  assert.ok(report.missions.every((mission) => !mission.completed));
  assert.ok(progressRules.length > 0);
});

test("distinct categories award breadth XP, not raw scan spam", () => {
  // 5 scans but only 2 distinct categories => only 20 XP (2 x 10), no milestone.
  const scans = [
    { category: "paper", createdAt: daysAgo(0) },
    { category: "paper", createdAt: daysAgo(0) },
    { category: "paper", createdAt: daysAgo(0) },
    { category: "plastic", createdAt: daysAgo(0) },
    { category: "plastic", createdAt: daysAgo(0) },
  ];
  const report = computeProgress(scans, []);
  assert.equal(report.distinctCategories.length, 2);
  assert.equal(report.ecoXp, 20);
  assert.equal(report.classificationCount, 5);
  const three = report.missions.find((mission) => mission.id === "three-categories");
  assert.equal(three.progress, 2);
  assert.equal(three.completed, false);
});

test("milestones and level thresholds derive from real categories", () => {
  const categories = ["paper", "plastic", "glass", "metal", "organic", "other"];
  const scans = categories.map((category) => ({ category, createdAt: daysAgo(1) }));
  const report = computeProgress(scans, []);
  // 6*10 + 20 (3-cat) + 30 (all-6) = 110.
  assert.equal(report.ecoXp, 110);
  assert.equal(report.level, 3); // Planta (threshold 80)
  assert.equal(report.nextLevel, 4);
  assert.equal(report.xpToNextLevel, 10); // 120 - 110
  const complete = report.badges.find((badge) => badge.id === "complete");
  assert.equal(complete.earned, true);
  assert.ok(complete.earnedAt);
});

test("deliveries award XP only when real and increase when approved", () => {
  const pending = computeProgress([], [{ status: "pending", createdAt: daysAgo(2) }]);
  assert.equal(pending.ecoXp, 25); // first-delivery only
  const approved = computeProgress([], [
    { status: "pending", createdAt: daysAgo(2) },
    { status: "approved", createdAt: daysAgo(1) },
  ]);
  // 25 (first) + 25 (one approved) = 50.
  assert.equal(approved.ecoXp, 50);
  assert.equal(approved.approvedDeliveryCount, 1);
  const verified = approved.badges.find((badge) => badge.id === "delivery-verified");
  assert.equal(verified.earned, true);
});

test("streak counts consecutive real days ending today or yesterday", () => {
  const scans = [
    { category: "paper", createdAt: daysAgo(0) },
    { category: "plastic", createdAt: daysAgo(1) },
    { category: "glass", createdAt: daysAgo(2) },
  ];
  const report = computeProgress(scans, []);
  assert.equal(report.streakDays, 3);
  const streak = report.badges.find((badge) => badge.id === "streak-3");
  assert.equal(streak.earned, true);
});

test("streak is zero when the last activity is older than yesterday", () => {
  const scans = [
    { category: "paper", createdAt: daysAgo(5) },
    { category: "plastic", createdAt: daysAgo(6) },
  ];
  const report = computeProgress(scans, []);
  assert.equal(report.streakDays, 0);
});

test("invalid dates never produce NaN progress", () => {
  const report = computeProgress([{ category: "paper", createdAt: "not-a-date" }], []);
  assert.ok(Number.isSafeInteger(report.ecoXp));
  assert.equal(report.ecoXp, 10); // Distinct category still counts.
});
