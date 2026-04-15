import type { Message } from "@archastro/sdk";

export const SEARCH_HIGHLIGHT_ATTR = "data-jump-search-highlight";

export function normalizeSearchContent(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 4) {
    return null;
  }

  return normalized;
}

export function findMatchingMessageId(
  candidates: Pick<Message, "id" | "content">[],
  params: {
    messageId?: string | null;
    messageContent?: string | null;
  },
): string | null {
  const { messageId, messageContent } = params;

  if (messageId && candidates.some((message) => message.id === messageId)) {
    return messageId;
  }

  const normalizedTarget = normalizeSearchContent(messageContent);
  if (!normalizedTarget) {
    return null;
  }

  const match = candidates.find((message) => {
    const normalizedMessage = normalizeSearchContent(message.content);
    if (!normalizedMessage) {
      return false;
    }

    return (
      normalizedMessage.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedMessage)
    );
  });

  return match?.id ?? null;
}

function buildHighlightMatcher(term?: string | null): RegExp | null {
  const target = term?.trim();
  if (!target || target.length < 2) {
    return null;
  }

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "ig");
}

export function clearSearchHighlights(root: ParentNode = document): void {
  const highlighted = root.querySelectorAll(
    `mark[${SEARCH_HIGHLIGHT_ATTR}="true"]`,
  );

  highlighted.forEach((node) => {
    const parent = node.parentNode;
    if (!parent) {
      return;
    }
    const text = document.createTextNode(node.textContent ?? "");
    parent.replaceChild(text, node);
    parent.normalize();
  });
}

export function highlightSearchTermInElement(
  container: HTMLElement,
  term?: string | null,
): boolean {
  const matcher = buildHighlightMatcher(term);
  if (!matcher) {
    return false;
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    if (current instanceof Text) {
      const parentTag = current.parentElement?.tagName?.toLowerCase();
      if (
        parentTag !== "script" &&
        parentTag !== "style" &&
        parentTag !== "textarea" &&
        parentTag !== "input" &&
        (current.textContent?.trim()?.length ?? 0) > 0
      ) {
        textNodes.push(current);
      }
    }
    current = walker.nextNode();
  }

  let replacements = 0;
  for (const node of textNodes) {
    const text = node.textContent ?? "";
    matcher.lastIndex = 0;
    if (!matcher.test(text)) {
      continue;
    }
    matcher.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      const mark = document.createElement("mark");
      mark.setAttribute(SEARCH_HIGHLIGHT_ATTR, "true");
      mark.className = "rounded px-0.5 bg-amber-200 text-amber-900";
      mark.textContent = text.slice(start, end);
      fragment.appendChild(mark);
      replacements += 1;

      lastIndex = end;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return replacements > 0;
}
