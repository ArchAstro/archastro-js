import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { ChatInput } from "../chat-input.js";

// jsdom does not implement URL.createObjectURL / revokeObjectURL
beforeAll(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  globalThis.URL.revokeObjectURL = vi.fn();
});

function createFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function getFileInput(): HTMLInputElement {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  if (!input) throw new Error("Hidden file input not found");
  return input;
}

describe("ChatInput", () => {
  it("renders paperclip and send buttons", () => {
    render(<ChatInput onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByLabelText("Attach file")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
  });

  it("sends text-only message without uploads", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Reply to your helper...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("hello", undefined);
    });
  });

  it("shows attachment preview after selecting a file", async () => {
    render(<ChatInput onSend={vi.fn().mockResolvedValue(undefined)} />);

    const file = createFile("photo.png", 1024, "image/png");
    const input = getFileInput();

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });

  it("shows error for files exceeding 15 MB", () => {
    render(<ChatInput onSend={vi.fn().mockResolvedValue(undefined)} />);

    const bigFile = createFile("huge.zip", 16 * 1024 * 1024, "application/zip");
    const input = getFileInput();

    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(screen.getByText(/15 MB/)).toBeInTheDocument();
  });

  it("removes an attachment when X is clicked", () => {
    render(<ChatInput onSend={vi.fn().mockResolvedValue(undefined)} />);

    const file = createFile("readme.txt", 100, "text/plain");
    const input = getFileInput();

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("readme.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Remove readme.txt"));
    expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
  });

  it("sends uploads when attachments are present", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ChatInput onSend={onSend} />);

    const file = createFile("report.pdf", 2048, "application/pdf");
    const input = getFileInput();
    fireEvent.change(input, { target: { files: [file] } });

    const textarea = screen.getByPlaceholderText("Reply to your helper...");
    fireEvent.change(textarea, { target: { value: "see attached" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        "see attached",
        expect.arrayContaining([
          expect.objectContaining({
            name: "report.pdf",
            mime_type: "application/pdf",
          }),
        ]),
      );
    });
  });

  it("can send with only attachments and no text", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ChatInput onSend={onSend} />);

    const file = createFile("data.csv", 512, "text/csv");
    const input = getFileInput();
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        "",
        expect.arrayContaining([
          expect.objectContaining({
            name: "data.csv",
            mime_type: "text/csv",
          }),
        ]),
      );
    });
  });
});
