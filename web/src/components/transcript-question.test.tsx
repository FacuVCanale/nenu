import { render, screen, within } from "@testing-library/react";

import { TranscriptQuestion } from "./transcript-question";

describe("TranscriptQuestion", () => {
  it("marks the option the agent recommends with a badge instead of its label suffix", () => {
    render(<TranscriptQuestion title="How should we calibrate?" options={["Here in the terminal (Recommended)", "Publish the page again"]} active={false} />);
    const block = screen.getByRole("region", { name: "Agent question" });
    expect(within(block).getByText("Here in the terminal")).toBeVisible();
    expect(within(block).queryByText(/\(Recommended\)/)).not.toBeInTheDocument();
    expect(within(block).getByText("Recommended")).toBeVisible();
  });

  it("shows what each option means under its label, as the live card does", () => {
    render(<TranscriptQuestion title="Which fruit?" options={["Apple", "Pear"]} descriptions={["Crisp and red.", ""]} active={false} />);
    const apple = screen.getByRole("button", { name: /Apple/ });
    expect(within(apple).getByText("Crisp and red.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pear" })).toBeVisible();
  });
});
