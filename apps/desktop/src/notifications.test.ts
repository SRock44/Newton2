import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: (...args: unknown[]) => isPermissionGranted(...args),
  requestPermission: (...args: unknown[]) => requestPermission(...args),
  sendNotification: (...args: unknown[]) => sendNotification(...args),
}));

import { notifyStudyReminders } from "./notifications";

describe("notifyStudyReminders", () => {
  beforeEach(() => {
    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    sendNotification.mockReset();
  });

  it("does nothing when there is nothing due", async () => {
    await notifyStudyReminders(0, 0);
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends a notification mentioning due flashcards when permission is already granted", async () => {
    isPermissionGranted.mockResolvedValue(true);
    await notifyStudyReminders(3, 0);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith({
      title: "Newton",
      body: "3 flashcards due for review",
    });
  });

  it("uses singular wording for exactly one due item of each kind", async () => {
    isPermissionGranted.mockResolvedValue(true);
    await notifyStudyReminders(1, 1);

    expect(sendNotification).toHaveBeenCalledWith({
      title: "Newton",
      body: "1 flashcard due for review · 1 assignment due soon",
    });
  });

  it("requests permission if not already granted, and sends once granted", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");

    await notifyStudyReminders(0, 2);

    expect(requestPermission).toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith({
      title: "Newton",
      body: "2 assignments due soon",
    });
  });

  it("does not send a notification if permission is denied", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");

    await notifyStudyReminders(5, 0);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never throws if the notification API itself errors", async () => {
    isPermissionGranted.mockRejectedValue(new Error("no Tauri context"));
    await expect(notifyStudyReminders(1, 0)).resolves.toBeUndefined();
  });
});

/** apps/web's path: jsdom has no `__TAURI_INTERNALS__` bridge, which is the real
 * environment this branch is actually meant for — isTauri() (lib/platform.ts) sees false
 * here the same way it would in a real browser tab, so these exercise notifications.ts's
 * web branch (the standard `Notification` API) rather than needing a separate stub. */
describe("notifyStudyReminders (web / plain browser — no Tauri bridge)", () => {
  let notificationCtor: (title: string, options?: NotificationOptions) => void;
  let requestPermissionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // test/setup.ts stubs __TAURI_INTERNALS__ on by default (this suite otherwise
    // exercises the desktop/Tauri build) — remove it for just this describe block so
    // isTauri() actually sees the plain-browser case these tests are named for.
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    sendNotification.mockReset();

    requestPermissionMock = vi.fn();
    notificationCtor = vi.fn((_title: string, _options?: NotificationOptions) => {});
    class FakeNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = requestPermissionMock;
      constructor(title: string, options?: NotificationOptions) {
        notificationCtor(title, options);
      }
    }
    vi.stubGlobal("Notification", FakeNotification as unknown as typeof Notification);
  });

  afterEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
  });

  it("never touches the Tauri plugin on the web path", async () => {
    (globalThis.Notification as unknown as { permission: string }).permission = "granted";
    await notifyStudyReminders(2, 0);

    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(notificationCtor).toHaveBeenCalledWith("Newton", { body: "2 flashcards due for review" });
  });

  it("requests permission via the standard Notification API when not yet decided", async () => {
    (globalThis.Notification as unknown as { permission: string }).permission = "default";
    requestPermissionMock.mockResolvedValue("granted");

    await notifyStudyReminders(0, 1);

    expect(requestPermissionMock).toHaveBeenCalled();
    expect(notificationCtor).toHaveBeenCalledWith("Newton", { body: "1 assignment due soon" });
  });

  it("sends nothing once the student has denied notifications for this site", async () => {
    (globalThis.Notification as unknown as { permission: string }).permission = "denied";
    await notifyStudyReminders(3, 0);

    expect(requestPermissionMock).not.toHaveBeenCalled();
    expect(notificationCtor).not.toHaveBeenCalled();
  });

  it("degrades to doing nothing (not throwing) if Notification isn't available at all", async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- deliberately simulating an environment with no Notification API
    delete globalThis.Notification;
    await expect(notifyStudyReminders(1, 0)).resolves.toBeUndefined();
  });
});
