import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { buildLabel } from "@/lib/build";
import { __resetServerBuild, observeServerBuild } from "@/lib/server-build";
import { BuildStamp } from "./build-stamp";

// The stamp names the bundle this page runs and nothing else: what to do about a newer build lives in
// the Updates card (SYS-08), so the footer stays passive text.
afterEach(() => __resetServerBuild());

describe("BuildStamp", () => {
  it("is passive text naming this bundle, even when the server runs another build", () => {
    render(<BuildStamp />);
    act(() => observeServerBuild("0.99.0+new.1"));
    expect(screen.getByText(buildLabel())).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/reload interface/i)).toBeNull();
  });
});
