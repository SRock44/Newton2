import { describe, it, expect, vi, beforeEach } from "vitest";

const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();
const onAction = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: (...args: unknown[]) => isPermissionGranted(...args),
  requestPermission: (...args: unknown[]) => requestPermission(...args),
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  onAction: (...args: unknown[]) => onAction(...args),
}));

import { listenStudyReminderActions, notifyStudyReminders, notifyTrayHideHint } from "./notifications";

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
      extra: { kind: "study-reminder" },
    });
  });

  it("uses singular wording for exactly one due item of each kind", async () => {
    isPermissionGranted.mockResolvedValue(true);
    await notifyStudyReminders(1, 1);

    expect(sendNotification).toHaveBeenCalledWith({
      title: "Newton",
      body: "1 flashcard due for review · 1 assignment due soon",
      extra: { kind: "study-reminder" },
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
      extra: { kind: "study-reminder" },
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

describe("notifyTrayHideHint", () => {
  beforeEach(() => {
    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    sendNotification.mockReset();
  });

  it("sends the still-running-in-the-tray wording when permission is granted", async () => {
    isPermissionGranted.mockResolvedValue(true);
    await notifyTrayHideHint();

    expect(sendNotification).toHaveBeenCalledWith({
      title: "Newton",
      body: "Still running in the tray. Open Newton from the icon, or choose Quit to exit.",
    });
  });

  it("does not send if permission is denied", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    await notifyTrayHideHint();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("listenStudyReminderActions", () => {
  beforeEach(() => {
    onAction.mockReset();
  });

  it("calls onOpen only for study-reminder extras", async () => {
    let captured: ((notification: { extra?: { kind?: string } }) => void) | undefined;
    onAction.mockImplementation(async (cb: (notification: { extra?: { kind?: string } }) => void) => {
      captured = cb;
      return { unregister: vi.fn() };
    });
    const onOpen = vi.fn();
    await listenStudyReminderActions(onOpen);

    captured?.({ extra: { kind: "study-reminder" } });
    captured?.({ extra: { kind: "tray-hint" } });
    captured?.({});
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
