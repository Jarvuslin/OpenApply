"use client";

import type { ReactElement } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { NeedsYouQuery } from "@openapply/contracts/application-question";
import type { Route } from "next";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { z } from "zod/v4";
import { useApiQuery } from "@/api/hooks";
import { questionQueries } from "@/api/question-queries";
import { QuestionCard } from "@/components/features/questions/question-card";
import { PaginationFooter } from "@/components/ui/data";
import { useHydrated } from "@/hooks/use-hydrated";
import { useNeedsYouCount } from "@/hooks/use-needs-you";
import { usePaginationParams } from "@/hooks/use-pagination";
import { ApplicationQuestionCard } from "./application-question-card";

export function NeedsYouView(): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading questions" />;
  return <NeedsYouContent />;
}

function NeedsYouContent(): ReactElement {
  const pagination = usePaginationParams();
  const params = useSearchParams();
  const requestedKind = params.get("kind");
  const parsedTarget = z.uuid().safeParse(params.get("target"));
  const target = parsedTarget.success ? parsedTarget.data : undefined;
  const kind: NeedsYouQuery["kind"] =
    requestedKind === "application" ||
    requestedKind === "operational" ||
    requestedKind === "collection"
      ? requestedKind
      : "all";
  const counts = useNeedsYouCount();
  const list = useApiQuery(
    questionQueries.list({ ...pagination.query, kind, ...(target ? { target } : {}) }),
    {
      refetchInterval: 15_000,
    },
  );
  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        Answer saved questions even when your computer is offline. Only answers you confirm are
        used. Work resumes only when the server confirms its blockers are resolved.
      </Typography>
      {target && (
        <Alert
          severity="info"
          action={
            <Button component={NextLink} href="/needs-you">
              Show all questions
            </Button>
          }
        >
          Showing the linked request. A resolved or expired request may no longer need your
          attention.
        </Alert>
      )}
      {counts.data && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Chip data-needs-you-total={counts.data.total} label={`${counts.data.total} need you`} />
          <Chip label={`${counts.data.application} application`} />
          <Chip label={`${counts.data.operational} operational`} />
          <Chip label={`${counts.data.collection} forms to inspect`} />
        </Stack>
      )}
      {counts.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void counts.refetch()}>Retry totals</Button>}
        >
          Could not load unanswered totals.
        </Alert>
      )}
      <TextField
        select
        label="Question type"
        value={kind}
        onChange={(event) => pagination.setFilters({ kind: event.target.value })}
        sx={{ maxWidth: 320 }}
      >
        <MenuItem value="all">All questions</MenuItem>
        <MenuItem value="application">Application questions</MenuItem>
        <MenuItem value="operational">Operational questions</MenuItem>
        <MenuItem value="collection">Forms to inspect</MenuItem>
      </TextField>
      {list.isLoading && <LinearProgress aria-label="Loading questions" />}
      {list.error && (
        <Alert severity="error" action={<Button onClick={() => void list.refetch()}>Retry</Button>}>
          Could not load your questions. No answers were changed.
        </Alert>
      )}
      {!list.isLoading && !list.error && list.data?.items.length === 0 && (
        <Typography>No unanswered questions in this view.</Typography>
      )}
      {list.data?.items.map((item) => {
        if (item.kind === "application")
          return <ApplicationQuestionCard key={item.id} question={item.question} job={item.job} />;
        if (item.kind === "operational")
          return <QuestionCard key={item.id} question={item.question} />;
        return (
          <Card
            key={item.id}
            variant="outlined"
            component="article"
            data-question-collection-id={item.id}
          >
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="h6">Inspect application form</Typography>
                <Typography>
                  {item.job.title} · {item.job.company}
                </Typography>
                <Alert severity="warning">
                  {item.collection.reason ||
                    "The full form has not been observed. More required questions may remain."}
                </Alert>
                <Typography variant="body2">
                  Coverage: {item.collection.coverage.replaceAll("_", " ")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.collection.source.replaceAll("_", " ")} · {item.collection.collectorVersion}{" "}
                  · {new Date(item.collection.observedAt).toLocaleString()}
                </Typography>
                <Link component={NextLink} href={`/campaigns/${item.job.campaignId}` as Route}>
                  Open job details to collect questions
                </Link>
                <Link href={item.collection.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View form source
                </Link>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
      {list.data && (
        <PaginationFooter
          pagination={list.data.pagination}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </Stack>
  );
}
