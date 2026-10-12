import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { render, screen } from "@testing-library/react";

import { DogGallop } from "./dog-gallop";

describe("DogGallop", () => {
  it("renders a decorative mascot by default (aria-hidden, no img role)", () => {
    const { container } = render(<DogGallop />);
    const el = container.querySelector(".dog-gallop");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("adds the running modifier only while galloping", () => {
    const { container, rerender } = render(<DogGallop running={false} />);
    expect(container.querySelector(".dog-gallop")).not.toHaveClass("dog-gallop--running");
    rerender(<DogGallop running />);
    expect(container.querySelector(".dog-gallop")).toHaveClass("dog-gallop--running");
  });

  it("exposes an accessible image when given a label", () => {
    render(<DogGallop label="Loading" />);
    const el = screen.getByRole("img", { name: "Loading" });
    expect(el).not.toHaveAttribute("aria-hidden");
  });

  it("drives the activity mark size from a single --dog-size length", () => {
    const { container } = render(<DogGallop size="4rem" />);
    expect(container.querySelector<HTMLElement>(".dog-gallop")?.style.getPropertyValue("--dog-size")).toBe(
      "4rem",
    );
  });

  it("forwards className for placement", () => {
    const { container } = render(<DogGallop className="mr-2" />);
    expect(container.querySelector(".dog-gallop")).toHaveClass("mr-2");
  });

  it("ships a mark with its own transparency, so no surface shows a square tile behind the dog", () => {
    // The generated mark was black on an off-white (254) tile; every surface had to blend it away,
    // and the boot splash, which only inverts it, drew the tile. PNG colour type 6 is RGBA.
    const png = readFileSync(resolve(import.meta.dirname, "../../public/nenu-mark.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    // 8-bit RGBA, not interlaced, so the first scanline starts with the top-left pixel.
    expect([png[24], png[25], png[28]]).toEqual([8, 6, 0]);
    const idat: Buffer[] = [];
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      if (png.subarray(at + 4, at + 8).toString("ascii") === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    // Byte 0 is the row's filter; every filter leaves the first pixel of the first row as stored.
    const pixels = inflateSync(Buffer.concat(idat));
    expect(pixels[4]).toBe(0);
  });
});
