import { render } from "@testing-library/react";

import { mathmlToReact } from "./mathml";

// The MathML a formula renders to reaches the DOM only through this allowlist: known MathML
// elements, their layout attributes and Temml's own classes. Everything else (scripts, HTML,
// handlers, links, inline styles) is dropped, so the boundary holds even if the TeX engine ever
// emitted something it should not.
describe("mathmlToReact", () => {
  const draw = (markup: string) => render(<>{mathmlToReact(markup)}</>).container;

  it("keeps MathML structure, text and layout attributes", () => {
    const root = draw('<math display="block"><mfrac><mi>a</mi><mn>2</mn></mfrac><mo stretchy="false">)</mo></math>');
    const math = root.querySelector("math")!;
    expect(math.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    expect(math.getAttribute("display")).toBe("block");
    expect(math.querySelector("mfrac > mi")).toHaveTextContent("a");
    expect(math.querySelector("mo")!.getAttribute("stretchy")).toBe("false");
  });

  it("drops scripts, HTML, handlers and links", () => {
    const root = draw(
      '<math><mi onclick="alert(1)" href="javascript:alert(1)" id="x">a</mi><script>alert(1)</script>' +
        '<mtext><b>bold</b></mtext><img src=x onerror="alert(1)"><iframe src="https://evil"></iframe></math>',
    );
    expect(root.querySelector("script, b, img, iframe")).toBeNull();
    expect(root.querySelector("[onclick], [href], [onerror], [id]")).toBeNull();
    expect(root.querySelector("mi")).toHaveTextContent("a");
    expect(root.textContent).not.toContain("alert");
  });

  it("keeps only Temml's classes, and no inline style", () => {
    const root = draw(
      '<math><mtd class="tml-right fixed inset-0" style="padding-left:0em;background:url(https://evil/x.png);position:fixed"><mi>a</mi></mtd></math>',
    );
    const cell = root.querySelector("mtd")!;
    expect(cell.getAttribute("class")).toBe("tml-right");
    expect(cell.hasAttribute("style")).toBe(false);
  });
});
