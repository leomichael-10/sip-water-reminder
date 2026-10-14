import { test } from "node:test";
import assert from "node:assert/strict";
import { compositeOver, contrastRatio } from "./contrast";

// Keep these in sync with the --color-* values in app/globals.css.
const LIGHT = {
  pageBg: "#eaf4ff", // start stop of the pastel gradient, worst-case backdrop for glass cards
  ink: "#f6f1ff",
  deep: "rgba(255, 255, 255, 0.55)",
  water: "#2a63cc",
  foam: "#3d2f66",
};
const DARK = {
  pageBg: "#140a2e", // start stop of the night-sky gradient
  ink: "#150c2e",
  deep: "rgba(255, 255, 255, 0.08)",
  water: "#5fb0ff",
  foam: "#f0e9ff",
};

const MIN_CONTRAST = 4.5;

test("light: foam text on ink background", () => {
  assert.ok(contrastRatio(LIGHT.foam, LIGHT.ink) >= MIN_CONTRAST);
});

test("light: foam text on the glassy deep card, composited over the page gradient", () => {
  const effective = compositeOver(LIGHT.deep, LIGHT.pageBg);
  assert.ok(contrastRatio(LIGHT.foam, effective) >= MIN_CONTRAST);
});

test("light: ink text on the water accent button background", () => {
  assert.ok(contrastRatio(LIGHT.ink, LIGHT.water) >= MIN_CONTRAST);
});

test("dark: foam text on ink background", () => {
  assert.ok(contrastRatio(DARK.foam, DARK.ink) >= MIN_CONTRAST);
});

test("dark: foam text on the glassy deep card, composited over the page gradient", () => {
  const effective = compositeOver(DARK.deep, DARK.pageBg);
  assert.ok(contrastRatio(DARK.foam, effective) >= MIN_CONTRAST);
});

test("dark: ink text on the water accent button background", () => {
  assert.ok(contrastRatio(DARK.ink, DARK.water) >= MIN_CONTRAST);
});
