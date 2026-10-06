"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { queryKeys } from "@/api/query-keys";
import type { GmailCheckResult } from "@/lib/gmail-check-result";
import { checkGmail, type TerminalProviderId } from "@/lib/terminal";

interface CheckNotice {
  severity: "info" | "success" | "warning" | "error";
  text: string;
  action?: GmailCheckResult["action"];
}

export function useGmailCheck(provider: TerminalProviderId) {
  const queryClient = useQueryClient();
  const active = useRef<AbortController | null>(null);
  const previousProvider = useRef(provider);
  const [phase, setPhase] = useState<"checking" | "saving" | null>(null);
  const [notice, setNotice] = useState<CheckNotice | null>(null);
  const [confirmation, setConfirmation] = useState<{
    email: string;
    selectAfterCheck: boolean;
  } | null>(null);

  useEffect(() => {
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, []);

  useEffect(() => {
    if (previousProvider.current === provider) return;
    previousProvider.current = provider;
    active.current?.abort();
    active.current = null;
    setPhase(null);
    setNotice(null);
    setConfirmation(null);
  }, [provider]);

  const saveMailbox = async (
    controller: AbortController,
    email: string,
    selectAfterCheck: boolean,
    identityVerified: boolean,
  ): Promise<void> => {
    setPhase("saving");
    try {
      const saved = await api.email.accounts.connector.post(
        { mailbox: email, runtimeProvider: provider, identityVerified },
        { fetch: { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) } },
      );
      if (saved.error || !saved.data) throw new ApiError(saved.error);
      controller.signal.throwIfAborted();
      if (selectAfterCheck) {
        const selected = await api.email.accounts({ id: saved.data.id }).select.post(undefined, {
          fetch: { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) },
        });
        if (selected.error) throw new ApiError(selected.error);
      }
      controller.signal.throwIfAborted();
      setNotice({
        severity: "success",
        text: identityVerified
          ? `${email} verified and saved. Gmail identity and read access were checked. No messages were imported or sent.`
          : `${email} saved with your address confirmation. Gmail read access was checked; Claude did not verify the mailbox address. No messages were imported or sent.`,
      });
    } catch (error) {
      if (
        !controller.signal.aborted &&
        (!(error instanceof ApiError) || !error.status || error.status >= 500)
      ) {
        throw new Error(
          "Gmail read access was checked, but saving could not be confirmed. Mailbox status is refreshing; retry if the address is not listed.",
        );
      }
      throw error;
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.all });
    }
  };

  const handleFailure = (controller: AbortController, error: unknown): void => {
    if (active.current !== controller) return;
    if (controller.signal.aborted) {
      setNotice({ severity: "info", text: "Gmail check cancelled." });
    } else {
      const failure =
        error instanceof Error ? error.message : "Could not check Gmail. Please retry.";
      setNotice({
        severity: "error",
        text: failure,
        action: "retry",
      });
    }
  };

  const finish = (controller: AbortController): void => {
    if (active.current === controller) {
      active.current = null;
      setPhase(null);
    }
  };

  const run = async (email: string, selectAfterCheck = false): Promise<void> => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setConfirmation(null);
    setPhase("checking");
    setNotice({ severity: "info", text: `Checking Gmail access for ${email} in the background…` });
    try {
      const result = await checkGmail(provider, email, controller.signal);
      controller.signal.throwIfAborted();
      if (result.status === "read_access") {
        setConfirmation({ email, selectAfterCheck });
        setNotice({
          severity: "warning",
          text: `Gmail read access works. Claude does not report the connected mailbox address. Confirm that ${email} is the Gmail account shown in your Claude connectors before saving it.`,
          action: "confirm_mailbox",
        });
        return;
      }
      if (result.status !== "connected" || !result.mailbox) {
        setNotice({
          severity: result.status === "needs_user" ? "warning" : "error",
          text: result.message,
          action: result.action,
        });
        return;
      }
      await saveMailbox(controller, result.mailbox, selectAfterCheck, true);
    } catch (error) {
      handleFailure(controller, error);
    } finally {
      finish(controller);
    }
  };

  return {
    run,
    notice,
    phase,
    confirmation,
    busy: phase !== null,
    cancel: () => active.current?.abort(),
    confirm: async (): Promise<void> => {
      if (active.current || !confirmation) return;
      const controller = new AbortController();
      active.current = controller;
      const { email, selectAfterCheck } = confirmation;
      setConfirmation(null);
      try {
        await saveMailbox(controller, email, selectAfterCheck, false);
      } catch (error) {
        handleFailure(controller, error);
      } finally {
        finish(controller);
      }
    },
    dismissConfirmation: (): void => {
      setConfirmation(null);
      setNotice({ severity: "info", text: "Gmail read access was checked. No mailbox was saved." });
    },
  };
}
