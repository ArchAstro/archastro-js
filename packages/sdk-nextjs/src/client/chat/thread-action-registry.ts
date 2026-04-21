import type { ThreadAction } from "./types.js";

export type ThreadActionSurface = "inline" | "thread" | "account";

export interface ThreadActionPresentation {
  title: string;
  cta: string;
  priority: number;
  surfaces: ThreadActionSurface[];
  hint?: string;
}

export interface ResolveHrefOptions {
  threadId: string;
  teamId?: string | null;
  returnTo?: string;
}

const ACTION_PRESENTATIONS: Record<string, ThreadActionPresentation> = {
  connect_google: {
    title: "Connect Google",
    cta: "Connect",
    priority: 100,
    surfaces: ["inline", "thread", "account"],
    hint: "Enable Gmail, Calendar, and Docs for this conversation for personalized help.",
  },
  connect_github: {
    title: "Connect GitHub",
    cta: "Connect",
    priority: 90,
    surfaces: ["inline", "thread", "account"],
    hint: "Enable GitHub repositories and issues for this conversation for personalized help.",
  },
  connect_slack: {
    title: "Connect Slack",
    cta: "Connect",
    priority: 85,
    surfaces: ["inline", "thread", "account"],
    hint: "Enable Slack workspace messages for this conversation for personalized help.",
  },
  connect_microsoft: {
    title: "Connect Outlook",
    cta: "Connect",
    priority: 88,
    surfaces: ["inline", "thread", "account"],
    hint: "Enable Outlook email, calendar, and documents for this conversation for personalized help.",
  },
  connect_x_twitter: {
    title: "Connect X",
    cta: "Connect",
    priority: 84,
    surfaces: ["inline", "thread", "account"],
    hint: "Enable X/Twitter mentions and timelines for this conversation for personalized help.",
  },
  add_credential: {
    title: "Add website login",
    cta: "Add login",
    priority: 80,
    surfaces: ["inline", "thread", "account"],
    hint: "Your helper needs this website login to continue.",
  },
  update_credential: {
    title: "Update website login",
    cta: "Update login",
    priority: 78,
    surfaces: ["inline", "thread", "account"],
    hint: "Refresh this website login so helper actions can resume.",
  },
  setup_account: {
    title: "Connect integrations",
    cta: "Account settings",
    priority: 70,
    surfaces: ["thread", "account"],
    hint: "Go to Account settings to connect Gmail, Outlook, X/Twitter, Slack, GitHub, and website logins.",
  },
  send_email: {
    title: "Send email",
    cta: "Review",
    priority: 60,
    surfaces: ["inline", "thread"],
    hint: "Confirm before your helper sends this message.",
  },
  calendar_event: {
    title: "Calendar event",
    cta: "Review",
    priority: 60,
    surfaces: ["inline", "thread"],
    hint: "Confirm before your helper modifies your calendar.",
  },
  create_calendar: {
    title: "Create calendar",
    cta: "Review",
    priority: 60,
    surfaces: ["inline", "thread"],
    hint: "Confirm before your helper creates a new calendar.",
  },
};

const DEFAULT_PRESENTATION: ThreadActionPresentation = {
  title: "Action needed",
  cta: "Open",
  priority: 10,
  surfaces: ["thread"],
};

export function isPendingThreadAction(action: ThreadAction): boolean {
  const status = String(action.status || "active").toLowerCase();
  return status !== "done" && status !== "completed" && status !== "canceled";
}

export function getPendingThreadActions(
  actions: ThreadAction[],
): ThreadAction[] {
  return actions.filter(isPendingThreadAction).sort(sortByPriority);
}

export function getThreadActionPresentation(
  action: ThreadAction,
): ThreadActionPresentation {
  return ACTION_PRESENTATIONS[action.type] || DEFAULT_PRESENTATION;
}

export function resolveThreadActionHref(
  action: ThreadAction,
  options: ResolveHrefOptions,
): string | null {
  if (action.path && action.path.trim().length > 0) {
    return action.path;
  }

  const params = new URLSearchParams();
  params.set("thread_id", options.threadId);
  params.set("source_action", action.type);
  params.set("action_id", action.id);

  if (options.teamId) {
    params.set("team_id", options.teamId);
  }

  if (options.returnTo) {
    params.set("return_to", options.returnTo);
  }

  switch (action.type) {
    case "connect_google":
      return `/connectors/google?${params.toString()}`;
    case "connect_github":
      return `/connectors/github?${params.toString()}`;
    case "connect_slack":
      return `/connectors/slack?${params.toString()}`;
    case "connect_microsoft":
      return `/connectors/microsoft?${params.toString()}`;
    case "connect_x_twitter":
      return `/connectors/x-twitter?${params.toString()}`;
    case "add_credential": {
      const domain = getDomainFromAction(action);
      if (domain) {
        params.set("add_domain", domain);
      }
      return `/account?${params.toString()}`;
    }
    case "update_credential": {
      const domain = getDomainFromAction(action);
      if (domain) {
        params.set("update_domain", domain);
      }
      return `/account?${params.toString()}`;
    }
    case "setup_account":
      return `/account?${params.toString()}`;
    case "send_email":
      return `/thread/${encodeURIComponent(options.threadId)}?action=send_email&action_id=${encodeURIComponent(action.id)}`;
    case "calendar_event":
      return `/thread/${encodeURIComponent(options.threadId)}?action=calendar_event&action_id=${encodeURIComponent(action.id)}`;
    case "create_calendar":
      return `/thread/${encodeURIComponent(options.threadId)}?action=create_calendar&action_id=${encodeURIComponent(action.id)}`;
    default:
      return null;
  }
}

export function getDomainFromAction(action: ThreadAction): string | null {
  const raw =
    action.metadata?.domain ??
    action.metadata?.["domain" as keyof typeof action.metadata];

  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function sortByPriority(a: ThreadAction, b: ThreadAction): number {
  const aPriority = getThreadActionPresentation(a).priority;
  const bPriority = getThreadActionPresentation(b).priority;

  if (aPriority !== bPriority) {
    return bPriority - aPriority;
  }

  return a.type.localeCompare(b.type);
}
