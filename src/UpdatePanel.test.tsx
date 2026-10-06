import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePanel, type UpdateApi } from "./UpdatePanel";
import type { UpdateSnapshot } from "./updates";
import i18n from "./i18n";
beforeEach(async () => {
  await i18n.changeLanguage("zh");
});
afterEach(cleanup);

const initial: UpdateSnapshot = {
  currentVersion: "1.2.7",
  enabled: true,
  phase: "idle",
  update: null,
  downloaded: 0,
  total: null,
  error: null,
  visible: false,
  revision: 0,
};
function setup(state = initial) {
  let listener: (state: UpdateSnapshot) => void = () => {};
  const cleanup = vi.fn();
  const api: UpdateApi = {
    read: vi.fn().mockResolvedValue(state),
    check: vi.fn().mockResolvedValue({ ...state, phase: "up_to_date", visible: true, revision: 1 }),
    install: vi.fn().mockResolvedValue(state),
    subscribe: vi.fn().mockImplementation(async (handler) => {
      listener = handler;
      return cleanup;
    }),
  };
  return { api, cleanup, emit: (snapshot: UpdateSnapshot) => act(() => listener(snapshot)) };
}
describe("UpdatePanel", () => {
  it("shows current version and explicit manual result", async () => {
    const { api } = setup();
    render(<UpdatePanel settings api={api} />);
    await screen.findByText("v1.2.7 · stable");
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await screen.findByText("当前已是最新 stable 版本");
    expect(api.check).toHaveBeenCalledTimes(1);
  });
  it("keeps automatic no-update and failures quiet outside settings", async () => {
    const { api } = setup({ ...initial, phase: "up_to_date" });
    const { container } = render(<UpdatePanel settings={false} api={api} />);
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
  it("offers update and deduplicates repeated clicks while sending intent", async () => {
    const available = {
      ...initial,
      phase: "available" as const,
      visible: true,
      update: { version: "1.3.0", notes: "<script>not executable</script>" },
    };
    const { api } = setup(available);
    let resolve!: (snapshot: UpdateSnapshot) => void;
    api.install = vi.fn().mockImplementation(
      () =>
        new Promise<UpdateSnapshot>((done) => {
          resolve = done;
        }),
    );
    render(<UpdatePanel settings={false} api={api} />);
    const install = await screen.findByRole("button", { name: "更新并重启" });
    fireEvent.click(install);
    fireEvent.click(install);
    expect(api.install).toHaveBeenCalledExactlyOnceWith("1.3.0");
    expect(install).toBeDisabled();
    await act(async () => resolve({ ...available, phase: "confirming", revision: 1 }));
    expect(install).not.toBeInTheDocument();
  });
  it("shows signature/DMG errors, bounded progress, and ignores stale events", async () => {
    const { api, emit, cleanup } = setup();
    const { unmount } = render(<UpdatePanel settings api={api} />);
    await screen.findByText("v1.2.7 · stable");
    emit({ ...initial, phase: "downloading", visible: true, downloaded: 5, total: 5, revision: 5 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "5");
    emit({ ...initial, phase: "idle", revision: 1 });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    emit({ ...initial, phase: "error", visible: true, error: "signature", revision: 6 });
    expect(screen.getByText(/更新签名验证失败/)).toBeInTheDocument();
    emit({ ...initial, phase: "error", visible: true, error: "dmg_location", revision: 7 });
    expect(screen.getByText(/不能从 DMG 更新/)).toBeInTheDocument();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("displays disabled configuration without issuing automatic calls", async () => {
    const { api } = setup({
      ...initial,
      enabled: false,
      phase: "disabled",
      error: "not_configured",
    });
    render(<UpdatePanel settings api={api} />);
    await screen.findByText(/本构建未配置正式更新公钥/);
    expect(api.check).not.toHaveBeenCalled();
    expect(api.install).not.toHaveBeenCalled();
  });
  it("compact update notice opens settings without installing", async () => {
    const { api } = setup({
      ...initial,
      phase: "available",
      visible: true,
      update: { version: "1.3.0", notes: "notes" },
    });
    const open = vi.fn();
    render(<UpdatePanel settings={false} compact onOpenSettings={open} api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "应用更新" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(api.install).not.toHaveBeenCalled();
  });
});
