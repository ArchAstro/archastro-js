"use client";

import {
  getThreadActionPresentation,
  resolveThreadActionHref,
} from "./thread-action-registry.js";
import type { InlineActionCardProps } from "./types.js";

export function InlineActionCard({
  action,
  threadId,
  teamId,
  onRun,
  onDismiss,
  connectHref = "/account?integration=google",
}: InlineActionCardProps) {
  const presentation = getThreadActionPresentation(action);
  const isComplete = action.status === "done" || action.status === "completed";
  const hasNativeTemplate = Boolean(action.native_template?.component);
  const isSendEmail = action.type === "send_email";
  const isCalendarEvent = action.type === "calendar_event";
  const isCreateCalendar = action.type === "create_calendar";
  const isCalendarAction = isCalendarEvent || isCreateCalendar;
  const hasIntegration = Boolean(action.metadata?.integration_id);

  const needsConnect = isSendEmail && !hasIntegration && !isComplete;

  const href = resolveThreadActionHref(action, {
    threadId,
    teamId,
    returnTo: `/thread/${threadId}`,
  });

  const rawTo = action.metadata?.to;
  const emailTo: string | undefined = Array.isArray(rawTo)
    ? String(rawTo[0] ?? "")
    : typeof rawTo === "string"
      ? rawTo
      : undefined;
  const emailSubject =
    typeof action.metadata?.subject === "string"
      ? action.metadata.subject
      : undefined;

  const calendarName =
    typeof action.metadata?.calendar_name === "string"
      ? action.metadata.calendar_name
      : undefined;
  const calendarEventCount = Array.isArray(action.metadata?.events)
    ? action.metadata.events.length
    : 0;

  if (isComplete) {
    return (
      <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:max-w-md sm:p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-900">
              {isSendEmail
                ? "Sent"
                : isCreateCalendar
                  ? "Calendar Created"
                  : isCalendarEvent
                    ? "Events Updated"
                    : "Completed"}
            </p>
            {emailSubject && (
              <p className="truncate text-xs text-emerald-700">
                {emailSubject}
              </p>
            )}
            {isCalendarAction && calendarName && (
              <p className="truncate text-xs text-emerald-700">
                {calendarName}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (needsConnect) {
    return (
      <div className="w-full rounded-2xl border border-[var(--color-border)] bg-white p-3 sm:max-w-md sm:p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <MailIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-text)]">
              Email Draft Ready
            </p>
            {emailTo && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                To: {emailTo}
              </p>
            )}
            {emailSubject && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {emailSubject}
              </p>
            )}
            <p className="mt-1 text-xs text-amber-600">
              Go to Account settings to connect Gmail or Outlook
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(action)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:h-9 sm:w-9"
                aria-label="Dismiss action"
                title="Dismiss"
              >
                <XIcon />
              </button>
            )}
            <a
              href={connectHref}
              className="flex h-10 shrink-0 items-center rounded-full bg-[var(--color-accent)] px-4 text-sm font-medium text-white hover:opacity-90 sm:h-9"
            >
              Account settings
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (hasNativeTemplate) {
    const iconBg = isCalendarAction
      ? "bg-blue-100 text-blue-600"
      : "bg-purple-100 text-purple-600";
    const icon = isCalendarAction ? <CalendarIcon /> : <MailIcon />;

    return (
      <div className="w-full rounded-2xl border border-[var(--color-border)] bg-white p-3 sm:max-w-md sm:p-4">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-text)]">
              {isSendEmail ? "Send Email" : presentation.title}
            </p>
            {isSendEmail && emailTo && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                To: {emailTo}
              </p>
            )}
            {isSendEmail && emailSubject && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {emailSubject}
              </p>
            )}
            {isCalendarEvent && calendarName && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {calendarEventCount > 0
                  ? `${calendarEventCount} event${calendarEventCount !== 1 ? "s" : ""} on ${calendarName}`
                  : calendarName}
              </p>
            )}
            {isCreateCalendar && calendarName && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {typeof action.metadata?.name === "string"
                  ? action.metadata.name
                  : calendarName}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(action)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:h-9 sm:w-9"
                aria-label="Dismiss action"
                title="Dismiss"
              >
                <XIcon />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRun(action)}
              className="flex h-10 shrink-0 items-center rounded-full bg-[var(--color-accent)] px-4 text-sm font-medium text-white hover:opacity-90 sm:h-9"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={href || "#"}
      className="block w-full rounded-2xl border border-[var(--color-border)] bg-white p-3 hover:border-[var(--color-accent)] sm:max-w-md sm:p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          {renderActionIcon(action.type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text)]">
            {presentation.title}
          </p>
          {presentation.hint && (
            <p className="truncate text-xs text-[var(--color-text-muted)]">
              {presentation.hint}
            </p>
          )}
        </div>
        <span className="flex h-10 shrink-0 items-center rounded-full bg-[var(--color-accent)] px-4 text-sm font-medium text-white sm:h-9">
          {presentation.cta}
        </span>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function renderActionIcon(actionType: string) {
  switch (actionType) {
    case "connect_google":
      return <GoogleIcon />;
    case "connect_microsoft":
      return <OutlookIcon />;
    case "connect_github":
      return <GitHubIcon />;
    case "connect_slack":
      return <SlackIcon />;
    case "send_email":
      return <MailIcon />;
    case "calendar_event":
    case "create_calendar":
      return <CalendarIcon />;
    default:
      return <ActionIcon />;
  }
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5v-11Zm1.8.3 5.7 4.5 5.7-4.5H4.3Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function OutlookIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="8" height="14" rx="1.5" fill="#0A64C9" />
      <rect x="10" y="6" width="11" height="12" rx="1.5" fill="#1B7DE2" />
      <path
        d="M7 10.2c.9 0 1.6.8 1.6 1.8s-.7 1.8-1.6 1.8-1.6-.8-1.6-1.8.7-1.8 1.6-1.8Z"
        fill="#fff"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.5a8.5 8.5 0 0 0-2.7 16.6c.4.1.5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.8-.5 0-.5 0-.5.8.1 1.3.8 1.3.8.8 1.3 2 1 2.5.8.1-.5.3-.9.5-1.1-1.8-.2-3.8-.9-3.8-4a3 3 0 0 1 .8-2.1c-.1-.2-.3-1 .1-2.1 0 0 .7-.2 2.2.8a7.7 7.7 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-2 3.8-3.9 4 .3.3.6.8.6 1.6v2.3c0 .2.1.5.5.4A8.5 8.5 0 0 0 12 3.5Z"
        fill="#1F2937"
      />
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="2.5" width="4" height="9" rx="2" fill="#E01E5A" />
      <rect x="2.5" y="5" width="9" height="4" rx="2" fill="#E01E5A" />
      <rect x="13" y="2.5" width="4" height="9" rx="2" fill="#36C5F0" />
      <rect x="13" y="5" width="9" height="4" rx="2" fill="#36C5F0" />
      <rect x="13" y="12.5" width="4" height="9" rx="2" fill="#2EB67D" />
      <rect x="13" y="15" width="9" height="4" rx="2" fill="#2EB67D" />
      <rect x="5" y="12.5" width="4" height="9" rx="2" fill="#ECB22E" />
      <rect x="2.5" y="15" width="9" height="4" rx="2" fill="#ECB22E" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ActionIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <circle cx="10" cy="10" r="6" />
    </svg>
  );
}
