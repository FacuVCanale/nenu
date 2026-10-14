import { render, screen } from "@testing-library/react";

import { ReadOnlyBanner } from "./read-only-banner";

describe("ReadOnlyBanner", () => {
  it("draws nothing where device auth is off, unknown or this device is allowed", () => {
    const { container, rerender } = render(<ReadOnlyBanner device={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ReadOnlyBanner device={{ enforced: false, authorized: false, device: null }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ReadOnlyBanner device={{ enforced: true, authorized: true, device: "alex-iphone" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says it once, in one short line that names the device", () => {
    render(<ReadOnlyBanner device={{ enforced: true, authorized: false, device: "alex-iphone" }} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/^Read-only on this device · alex-iphone$/);
  });

  it("drops the device part when the proxy names none", () => {
    render(<ReadOnlyBanner device={{ enforced: true, authorized: false, device: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Read-only on this device$/);
  });
});
