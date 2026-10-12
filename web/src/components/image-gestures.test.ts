import { clampView, dragIntent, pageStep, project, resist, rubberband, shouldDismiss, velocity, zoomAt } from "./image-gestures";

const stage = { width: 390, height: 844 };
const portrait = { width: 390, height: 845 };

describe("rubberband", () => {
  it("follows less the further past the edge, and never as far as the finger", () => {
    expect(rubberband(0, 390)).toBe(0);
    const near = rubberband(40, 390), far = rubberband(400, 390);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(40);
    expect(far).toBeGreaterThan(near);
    expect(far / 400).toBeLessThan(near / 40);
    expect(rubberband(-40, 390)).toBeCloseTo(-near);
  });
});

describe("project", () => {
  it("carries a release forward in its direction, further the faster it was", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(99);
    expect(project(-2000)).toBeCloseTo(-198);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the finger where it was", () => {
    const at = { x: 60, y: -120 };
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2.5, at);
    // The content point under `at` before the zoom sits under it after: at = t + s * p.
    const before = { x: at.x / 1, y: at.y / 1 };
    expect(view.x + view.scale * before.x).toBeCloseTo(at.x);
    expect(view.y + view.scale * before.y).toBeCloseTo(at.y);
    expect(view.scale).toBe(2.5);
  });
});

describe("clampView", () => {
  it("keeps a zoomed picture covering the screen and a whole one centred", () => {
    expect(clampView({ scale: 1, x: 80, y: -40 }, portrait, stage)).toEqual({ scale: 1, x: 0, y: 0 });
    const zoomed = clampView({ scale: 2, x: 900, y: -900 }, portrait, stage);
    expect(zoomed).toEqual({ scale: 2, x: 195, y: -423 });
    expect(clampView({ scale: 9, x: 0, y: 0 }, portrait, stage).scale).toBe(4);
    expect(clampView({ scale: 0.4, x: 0, y: 0 }, portrait, stage).scale).toBe(1);
  });
});

describe("resist", () => {
  it("lets a pinch go a little past the limits instead of stopping dead", () => {
    const under = resist({ scale: 0.5, x: 0, y: 0 }, portrait, stage);
    expect(under.scale).toBeGreaterThan(0.5);
    expect(under.scale).toBeLessThan(1);
    const past = resist({ scale: 2, x: 400, y: 0 }, portrait, stage);
    expect(past.x).toBeGreaterThan(195);
    expect(past.x).toBeLessThan(400);
  });
});

describe("dragIntent", () => {
  it("waits out the slop, then reads a whole picture's drag by its main axis", () => {
    expect(dragIntent(4, 6, false)).toBeNull();
    expect(dragIntent(3, 40, false)).toBe("dismiss");
    expect(dragIntent(3, -40, false)).toBe("dismiss");
    expect(dragIntent(-40, 6, false)).toBe("page");
    expect(dragIntent(-40, 6, true)).toBe("pan");
  });
});

describe("shouldDismiss", () => {
  it("closes on a long pull or a flick down, never while the finger heads back up", () => {
    expect(shouldDismiss(300, 0, 844)).toBe(true);
    expect(shouldDismiss(40, 50, 844)).toBe(false);
    expect(shouldDismiss(60, 1600, 844)).toBe(true);
    expect(shouldDismiss(300, -600, 844)).toBe(false);
  });
});

describe("pageStep", () => {
  it("turns the page past halfway or on a flick, only toward a picture that exists", () => {
    expect(pageStep(-220, 0, 390, true, true)).toBe(1);
    expect(pageStep(220, 0, 390, true, true)).toBe(-1);
    expect(pageStep(-60, -1800, 390, true, true)).toBe(1);
    expect(pageStep(-60, 0, 390, true, true)).toBe(0);
    expect(pageStep(-300, 0, 390, true, false)).toBe(0);
  });
});

describe("velocity", () => {
  it("reads the last tenth of a second, and nothing from a single instant", () => {
    expect(velocity([{ t: 0, x: 0, y: 0 }])).toEqual({ x: 0, y: 0 });
    expect(velocity([{ t: 0, x: 0, y: 0 }, { t: 2, x: 50, y: 50 }])).toEqual({ x: 0, y: 0 });
    const v = velocity([{ t: 0, x: 0, y: 900 }, { t: 500, x: 0, y: 0 }, { t: 550, x: 0, y: 50 }, { t: 600, x: 10, y: 100 }]);
    expect(v.y).toBeCloseTo(1000);
    expect(v.x).toBeCloseTo(100);
  });
});
