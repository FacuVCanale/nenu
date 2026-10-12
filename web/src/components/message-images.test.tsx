import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FileMediaContext, FilePreviewContext } from "@/lib/file-preview-context";
import { ImageStrip, MessageImages } from "./message-images";

const media = (path: string) => `/file?path=${encodeURIComponent(path)}`;

it("shows a message's images without a caption under each one, naming them for assistive tech", () => {
  const open = vi.fn();
  render(
    <FileMediaContext.Provider value={media}>
      <FilePreviewContext.Provider value={open}>
        <MessageImages paths={["/tmp/shot-a.png", "/tmp/shot-b.png"]} />
      </FilePreviewContext.Provider>
    </FileMediaContext.Provider>,
  );
  expect(screen.queryByText(/^Image \d+$/)).toBeNull();
  expect(screen.getByRole("img", { name: "Image 1" })).toHaveAttribute("src", media("/tmp/shot-a.png"));
  fireEvent.click(screen.getByRole("button", { name: "Open Image 2" }));
  expect(open).toHaveBeenCalledWith("/tmp/shot-b.png");
});

it("counts the rest only when a long strip is cut short", () => {
  const images = Array.from({ length: 6 }, (_, i) => ({ src: `/i/${i}.png`, label: `Image ${i + 1}`, item: { kind: "file" as const, path: `/i/${i}.png` } }));
  const { rerender } = render(<ImageStrip images={images} max={3} />);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Open 3 more images" })).toHaveTextContent("+3");
  rerender(<ImageStrip images={images.slice(0, 3)} max={3} />);
  expect(screen.queryByRole("button", { name: /more images/ })).toBeNull();
});
