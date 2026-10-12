import { act, render, screen } from "@testing-library/react";

import { Dialog } from "./dialog";

/** The browser's exit animation, which jsdom does not run: the test decides when it ends. */
function stubExitAnimation() {
  let end!: () => void;
  const finished = new Promise<void>((resolve) => { end = resolve; });
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [{ animationName: "exit", finished }] });
  return async () => {
    end();
    await act(async () => { await finished; });
  };
}
afterEach(() => { delete (Element.prototype as { getAnimations?: unknown }).getAnimations; });

const dialog = (container: HTMLElement) => container.querySelector("dialog")!;

it("keeps a closing dialog open, with what it said, until its exit ends", async () => {
  const finish = stubExitAnimation();
  const { container, rerender } = render(
    <Dialog open onClose={vi.fn()} title="Close this thread?" description="Hotfix login stops."><button type="button">Close thread</button></Dialog>,
  );
  expect(dialog(container)).toHaveAttribute("open");
  // Its owner clears the thread as it closes; the dialog fades out with the words it showed.
  rerender(<Dialog open={false} onClose={vi.fn()} title="Close this ?" description="" />);
  expect(dialog(container)).toHaveAttribute("open");
  expect(screen.getByText("Close this thread?")).toBeInTheDocument();
  expect(screen.getByText("Hotfix login stops.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close thread" })).toBeInTheDocument();

  await finish();
  expect(dialog(container)).not.toHaveAttribute("open");
  expect(screen.queryByText("Close this thread?")).toBeNull();
});

it("stays open when it is reopened before its exit ends", async () => {
  const finish = stubExitAnimation();
  const { container, rerender } = render(<Dialog open onClose={vi.fn()} title="Replace the coordinator?" />);
  rerender(<Dialog open={false} onClose={vi.fn()} title="Replace the coordinator?" />);
  rerender(<Dialog open onClose={vi.fn()} title="Replace the coordinator?" />);
  await finish();
  expect(dialog(container)).toHaveAttribute("open");
  expect(screen.getByText("Replace the coordinator?")).toBeInTheDocument();
});

it("closes at once where nothing animates its exit", () => {
  const { container, rerender } = render(<Dialog open onClose={vi.fn()} title="Merge this pull request?" />);
  rerender(<Dialog open={false} onClose={vi.fn()} title="Merge this pull request?" />);
  expect(dialog(container)).not.toHaveAttribute("open");
});
