import { describe, it, expect } from "vitest";

import {
  SEARCH_HIGHLIGHT_ATTR,
  clearSearchHighlights,
  findMatchingMessageId,
  normalizeSearchContent,
  highlightSearchTermInElement,
} from "../chat-search-utils.js";

describe("chat-search-utils", () => {
  describe("normalizeSearchContent", () => {
    it("normalizes casing and whitespace", () => {
      expect(normalizeSearchContent("  Hello   WORLD ")).toBe("hello world");
    });

    it("returns null for short content", () => {
      expect(normalizeSearchContent("abc")).toBeNull();
    });
  });

  describe("findMatchingMessageId", () => {
    const messages = [
      { id: "msg_1", content: "first message" },
      { id: "msg_2", content: "hello from helper" },
    ];

    it("prefers exact message id when present", () => {
      expect(
        findMatchingMessageId(messages, {
          messageId: "msg_2",
          messageContent: "ignored",
        }),
      ).toBe("msg_2");
    });

    it("matches by normalized content when id is unavailable", () => {
      expect(
        findMatchingMessageId(messages, {
          messageContent: " Hello   from   helper ",
        }),
      ).toBe("msg_2");
    });
  });

  describe("highlight lifecycle", () => {
    it("adds and clears marked highlight nodes", () => {
      const container = document.createElement("div");
      container.innerHTML = `<p>Hello helper world</p>`;

      const highlighted = highlightSearchTermInElement(container, "helper");
      expect(highlighted).toBe(true);
      expect(
        container.querySelector(`mark[${SEARCH_HIGHLIGHT_ATTR}="true"]`),
      ).not.toBeNull();

      clearSearchHighlights(container);
      expect(
        container.querySelector(`mark[${SEARCH_HIGHLIGHT_ATTR}="true"]`),
      ).toBeNull();
      expect(container.textContent).toContain("Hello helper world");
    });

    it("clears highlights only within the provided root", () => {
      const rootA = document.createElement("div");
      const rootB = document.createElement("div");

      rootA.innerHTML = `<p>alpha helper</p>`;
      rootB.innerHTML = `<p>beta helper</p>`;

      highlightSearchTermInElement(rootA, "helper");
      highlightSearchTermInElement(rootB, "helper");

      clearSearchHighlights(rootA);

      expect(
        rootA.querySelector(`mark[${SEARCH_HIGHLIGHT_ATTR}="true"]`),
      ).toBeNull();
      expect(
        rootB.querySelector(`mark[${SEARCH_HIGHLIGHT_ATTR}="true"]`),
      ).not.toBeNull();
    });
  });
});
