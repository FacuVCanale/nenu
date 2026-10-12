import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollToLatest } from "./scroll-to-latest";

// The way back says what it shows: VoiceOver reads the count, and Voice Control finds "2 new".
describe("ScrollToLatest", () => {
  it.each([
    [{}, "Scroll to latest"],
    [{ changed: true }, "Scroll to latest, updated"],
    [{ count: 2 }, "Scroll to latest, 2 new"],
    [{ count: null }, "Scroll to latest, New messages"],
    [{ waiting: true, count: 2 }, "Scroll to latest, Waiting on you"],
  ])("names the way back %o with what it shows", (props, name) => {
    render(<ScrollToLatest onClick={() => {}} {...props} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(name);
  });
});
