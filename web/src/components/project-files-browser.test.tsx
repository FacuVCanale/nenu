import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProjectFilesBrowser } from "./project-files-browser";
const fetchFiles = vi.fn();
vi.mock("@/lib/api", () => ({ fetchProjectFiles: (...args: unknown[]) => fetchFiles(...args) }));
it("expands folders in place, retains siblings and reads each folder only when first opened", async () => {
  const open = vi.fn();
  fetchFiles.mockImplementation(async (_pane: string, path: string) => ({ path, truncated: false, files: path === "." ? [{ name: "src", path: "src", kind: "directory" }, { name: "README.md", path: "README.md", kind: "file" }] : [{ name: "app.ts", path: "src/app.ts", kind: "file" }] }));
  render(<ProjectFilesBrowser paneId="p" onOpen={open} />);
  const folder = await screen.findByRole("button", { name: "src" });
  expect(fetchFiles).toHaveBeenCalledTimes(1);
  await userEvent.click(folder);
  await userEvent.click(await screen.findByRole("button", { name: "app.ts" }));
  expect(open).toHaveBeenCalledWith("src/app.ts");
  expect(screen.getByRole("button", { name: "README.md" })).toBeVisible();
  await userEvent.click(folder);
  expect(screen.queryByRole("button", { name: "app.ts" })).not.toBeInTheDocument();
  await userEvent.click(folder);
  expect(screen.getByRole("button", { name: "app.ts" })).toBeVisible();
  expect(fetchFiles).toHaveBeenCalledTimes(2);
});

// Each file reads as its kind: Markdown, TypeScript, and the document for a kind Nenu does not know.
it("marks each file with the icon of its kind", async () => {
  fetchFiles.mockResolvedValue({ path: ".", truncated: false, files: ["README.md", "app.ts", "data.bin"].map((name) => ({ name, path: name, kind: "file" })) });
  render(<ProjectFilesBrowser paneId="p" onOpen={vi.fn()} />);
  const glyph = async (name: string) => (await screen.findByRole("button", { name })).querySelector("svg")?.getAttribute("class");
  expect(await glyph("README.md")).toContain("icon-file-type");
  expect(await glyph("app.ts")).toContain("icon-typescript");
  expect(await glyph("data.bin")).toContain("icon-file-text");
});
